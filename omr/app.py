"""The register-and-detect service.

One endpoint, one job. It is handed a photograph, the code the caller believes
that page carries, and the geometry the page was printed with, and it answers
with a state and a confidence for every row, or with a reason it will not.

It holds no credentials, opens no database connection and keeps nothing. The
API downloads the image, calls this, and stores what comes back. Bind it to the
loopback address: it authenticates nobody, because nobody but the API on the
same host is ever meant to reach it.
"""

from __future__ import annotations

import json
import logging
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from detect import detect

MAX_IMAGE_BYTES = int(os.environ.get("OMR_MAX_IMAGE_BYTES", 12_000_000))

logging.basicConfig(
    level=os.environ.get("OMR_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("omr")

app = FastAPI(title="CMA Changamwe sheet reader", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/detect")
async def detect_sheet(
    image: UploadFile = File(...),
    sheet_code: str = Form(...),
    template: str = Form(...),
) -> JSONResponse:
    body = await image.read()
    if not body:
        raise HTTPException(status_code=400, detail="no image was sent")
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="that image is larger than this service accepts")

    try:
        geometry = json.loads(template)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=400, detail=f"the template is not valid JSON: {err}") from err

    for key in ("version", "page", "markers", "badge", "rows", "thresholds", "render_dpi"):
        if key not in geometry:
            raise HTTPException(status_code=400, detail=f"the template is missing {key}")

    result = detect(body, sheet_code, geometry)
    log.info(
        "sheet=%s status=%s rows=%d reason=%s",
        sheet_code, result["status"], len(result["rows"]), result["reject_reason"] or "-",
    )
    return JSONResponse(result)
