# The sheet reader

A small Python service that squares up a photographed attendance sheet and
measures its Present column. It is the only part of the system that is not
Node, and it stays small on purpose: it decides nothing.

It is given a photograph, the sheet code the API believes that page carries,
and the geometry the page was printed with. It answers with a state and a
confidence for every row, or with a reason it will not read the page. What that
means for attendance is decided in the API, by a person, on the review screen.

```
API  --(image + sheet code + template JSON)-->  reader
API  <--(per-row state and confidence)--------  reader
```

It holds no credentials, opens no database connection, and keeps nothing after
the response. The photographs it is sent carry member names, so **bind it to
127.0.0.1 and never route to it from Caddy.**

## What it actually does

1. **Quality gate.** Sharpness, brightness and contrast. A page too blurred or
   too dark is refused rather than guessed at.
2. **Find the corner marks.** Small solid squares, filtered by size,
   squareness and solidity, after the lighting has been divided out.
3. **Register.** A homography from those four points onto the template
   geometry, then warp the page flat at 200 dpi.
4. **Confirm the sheet.** Read the pointer QR from the header, check its
   checksum and template version, and check it names the sheet the API asked
   about. A page photographed against the wrong record is refused.
5. **Check the geometry landed.** Look for the ink of the printed box
   outlines in thin bands where the template says their edges are. Lined up,
   those bands come back about three quarters inked; drifted by one point,
   a third; by two, nothing. Below a third the page is refused.
6. **Measure.** For each row, the proportion of dark pixels well inside the
   printed box. Above the high threshold it is marked, below the low one it is
   blank, and between them it is uncertain and a person is asked.

Orientation is not assumed. If the pointer does not read, the page is warped
again at each quarter turn, so a sheet photographed upside down still resolves.

Step 5 is the one worth understanding, because the obvious check is worthless.
A homography solved from four points reproduces those four points perfectly, so
the corner marks always land where they belong no matter how wrong the rest of
the page is: measuring them proves nothing. The box outlines are independent
evidence, and they are the thing the measurement is taken from. Without that
check, a sheet photographed at a steep angle registers plausibly, lands a row
out, and is read confidently and wrongly. With it, the same sheet is refused.

### What it will and will not read

Measured on synthetic photographs from a real rendered sheet. Everything
outside these is refused with a reason, not guessed at.

| | Reads it | Refuses it |
|---|---|---|
| Perspective | up to about 12% keystone | beyond that |
| Rotation in frame | to about 5 degrees; any quarter turn | steeper angles |
| JPEG quality | down to 25 | |
| Camera shake | a 5-pixel blur | 9 and above |
| Resolution | down to about 1250 x 1700 | |

There is no case in that range where it reads a page wrongly and says nothing.
That property, not the size of the range, is the one the self-test protects.

## Running it

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 3002
```

Then point the API at it:

```
OMR_SERVICE_URL=http://127.0.0.1:3002
```

With that unset the OMR path reports itself unavailable and attendance is
entered by hand from the register screen, exactly as before Phase 9. That is
the intended fallback, not a failure mode.

In production it runs from `deploy/cma-omr.service`.

## Checking that both halves agree

The renderer and the reader are written in different languages against one
shared description of the page. `selftest.py` is what catches a disagreement:
it takes a real PDF from the Node renderer, ticks a known set of boxes,
roughs the page up the way a phone in a hall would, and checks every row comes
back with the state it was drawn.

```bash
cd ..
npm run omr:template > omr/template.json
npm run omr:sample -- --pages 1 --out omr/sample.pdf     # prints the sheet code
cd omr
.venv/bin/pip install pypdfium2
.venv/bin/python selftest.py --pdf sample.pdf --template template.json \
    --sheet-code <the code it printed>
```

A synthetic tick is cleaner than a real one, so a pass proves the geometry
agrees, not that the thresholds are right. It also checks the failures: a page
held upside down reads the same way, one held at a steep angle is refused
rather than read a row out, one too poorly lit is refused, and one photographed
against another sheet's code is refused.

CI runs exactly this on every push.

To check the wire between the two halves rather than the geometry, send a
photograph through the API's own client while the service is running:

```bash
OMR_SERVICE_URL=http://127.0.0.1:3002 npm run omr:check -- \
    --image page.jpg --sheet-code <code> --rows 23
```

## Choosing the thresholds

Print a batch of sheets, have them ticked the way the roll-callers actually
tick them, photograph them the way the secretary actually photographs them,
and run:

```bash
.venv/bin/python calibrate.py --template template.json photos/
```

It prints where the blank and marked clusters fall and where the gap between
them is. Put the two thresholds inside that gap, and store them in the
database rather than in code:

```sql
INSERT INTO matrix_config (key, value) VALUES ('omr_fill_low', '0.04')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
INSERT INTO matrix_config (key, value) VALUES ('omr_fill_high', '0.12')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

If the two clusters overlap, that is not a reason to squeeze the thresholds
together. It is the signal to change the sheet to say *shade the box*, reprint,
and measure again. The pipeline does not change either way.
