import { ImageResponse } from 'next/og';

/**
 * Generated rather than photographed. The association has no image library, and
 * a stock photograph of somebody else's congregation would misrepresent it.
 */
export const alt = 'Catholic Men Association, Changamwe Parish';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
    return new ImageResponse(
        (
            <div style={{
                width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                justifyContent: 'space-between', padding: 84,
                background: 'linear-gradient(135deg, #12293F 0%, #17324F 60%, #1F4368 100%)',
                color: '#ffffff',
                fontFamily: 'sans-serif',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    {/* Drawn, not typed: the glyph resolves to a colour emoji
                        in whatever font the renderer reaches for. */}
                    <div style={{
                        width: 72, height: 72, borderRadius: 16, background: '#0D1F31',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative',
                    }}>
                        <div style={{
                            position: 'absolute', width: 7, height: 42, borderRadius: 3,
                            background: '#F5E9D2', top: 13,
                        }}/>
                        <div style={{
                            position: 'absolute', width: 30, height: 7, borderRadius: 3,
                            background: '#F5E9D2', top: 26,
                        }}/>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>CMA CHANGAMWE</div>
                        <div style={{ fontSize: 19, color: '#DBE6F1' }}>Catholic Men Association</div>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 26, color: '#F5E9D2', letterSpacing: 3, marginBottom: 20 }}>
                        GOOD FAMILY; GOOD CHURCH
                    </div>
                    <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.15, maxWidth: 900 }}>
                        A movement of Catholic men at St. Mary&apos;s Changamwe
                    </div>
                </div>

                <div style={{ fontSize: 22, color: '#DBE6F1', display: 'flex' }}>
                    Commissioned 2012  ·  Six prayer houses  ·  Archdiocese of Mombasa
                </div>
            </div>
        ),
        size,
    );
}
