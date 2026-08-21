/*
    Animated neon plasma / vortex renderer
    ---------------------------------------

    Host provides:

        width
        height

    We provide:

        RenderFrame(frameIndex)

    Two UTF-16 characters encode each BGRA pixel:

        char 0 = B | (G << 8)
        char 1 = R | (255 << 8)

    This renderer avoids expensive per-pixel trig during animation by
    precomputing:

        - sine lookup table
        - radial distance field
        - x/y phase fields
        - 256-color palette
        - packed UTF-16 color characters
*/


// ============================================================
// Configuration
// ============================================================

var pixelCount = width * height;
var packed = new Array(pixelCount * 2);

var cx = width * 0.5;
var cy = height * 0.5;


// ============================================================
// Fast sine lookup table
// ============================================================

var SIN_SIZE = 1024;
var SIN_MASK = SIN_SIZE - 1;

var sinTable = new Array(SIN_SIZE);

for (var i = 0; i < SIN_SIZE; ++i)
{
    sinTable[i] =
        Math.sin(
            i * Math.PI * 2 / SIN_SIZE
        );
}


// ============================================================
// Precomputed coordinate information
// ============================================================

var xPhase1 = new Array(width);
var xPhase2 = new Array(width);

for (var x = 0; x < width; ++x)
{
    xPhase1[x] =
        (x * 9) & SIN_MASK;

    xPhase2[x] =
        (x * 17) & SIN_MASK;
}


var yPhase1 = new Array(height);
var yPhase2 = new Array(height);

for (var y = 0; y < height; ++y)
{
    yPhase1[y] =
        (y * 11) & SIN_MASK;

    yPhase2[y] =
        (y * 23) & SIN_MASK;
}


// ============================================================
// Precompute radial field
//
// The square root happens only once at startup.
// ============================================================

var radial = new Array(pixelCount);
var angleField = new Array(pixelCount);

var p = 0;

for (var y = 0; y < height; ++y)
{
    var dy = y - cy;

    for (var x = 0; x < width; ++x)
    {
        var dx = x - cx;

        var distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );

        radial[p] =
            (distance * 11) & SIN_MASK;


        /*
            atan2 is also performed only once.

            Convert angle to our 0..1023 sine-table domain.
        */
        var angle =
            Math.atan2(
                dy,
                dx
            );

        angleField[p] =
            (
                (
                    angle /
                    (Math.PI * 2)
                ) * SIN_SIZE
            ) & SIN_MASK;

        ++p;
    }
}


// ============================================================
// Palette
//
// Generate a rich RGB palette using phase-shifted sine waves.
// ============================================================

var paletteR = new Array(256);
var paletteG = new Array(256);
var paletteB = new Array(256);


/*
    More importantly, prepack each palette entry into the two
    UTF-16 strings required by the PowerShell framebuffer.

    That means RenderFrame doesn't call String.fromCharCode()
    for every pixel.
*/
var packedBG = new Array(256);
var packedRA = new Array(256);


for (var c = 0; c < 256; ++c)
{
    var phase =
        c / 256.0 *
        Math.PI * 2;


    var r =
        128 +
        127 *
        Math.sin(
            phase
        );


    var g =
        128 +
        127 *
        Math.sin(
            phase +
            2.094395102
        );


    var b =
        128 +
        127 *
        Math.sin(
            phase +
            4.188790205
        );


    r = r & 255;
    g = g & 255;
    b = b & 255;


    paletteR[c] = r;
    paletteG[c] = g;
    paletteB[c] = b;


    /*
        BGRA byte layout:

            first UTF-16:
                low  = B
                high = G

            second UTF-16:
                low  = R
                high = 255
    */

    packedBG[c] =
        String.fromCharCode(
            b |
            (g << 8)
        );


    packedRA[c] =
        String.fromCharCode(
            r |
            (255 << 8)
        );
}


// ============================================================
// Main renderer
// ============================================================

function RenderFrame(frameIndex)
{
    var output = 0;
    var pixel = 0;


    /*
        Different animation speeds for the individual fields.
    */

    var t1 =
        (frameIndex * 7) &
        SIN_MASK;

    var t2 =
        (frameIndex * 11) &
        SIN_MASK;

    var t3 =
        (frameIndex * 5) &
        SIN_MASK;

    var rotation =
        (frameIndex * 4) &
        SIN_MASK;


    for (var y = 0; y < height; ++y)
    {
        var yp1 =
            (
                yPhase1[y] +
                t1
            ) &
            SIN_MASK;


        var yp2 =
            (
                yPhase2[y] -
                t2
            ) &
            SIN_MASK;


        for (var x = 0; x < width; ++x)
        {
            // ------------------------------------------------
            // Horizontal wave
            // ------------------------------------------------

            var wave1 =
                sinTable[
                    (
                        xPhase1[x] +
                        t1
                    ) &
                    SIN_MASK
                ];


            // ------------------------------------------------
            // Vertical / diagonal wave
            // ------------------------------------------------

            var wave2 =
                sinTable[
                    (
                        yp1 +
                        xPhase2[x]
                    ) &
                    SIN_MASK
                ];


            // ------------------------------------------------
            // Radial expanding rings
            // ------------------------------------------------

            var wave3 =
                sinTable[
                    (
                        radial[pixel] -
                        t2
                    ) &
                    SIN_MASK
                ];


            // ------------------------------------------------
            // Rotating spiral component
            //
            // angle + radius produces a spiral rather than
            // simple circular rings.
            // ------------------------------------------------

            var spiral =
                sinTable[
                    (
                        angleField[pixel] +
                        rotation +
                        (
                            radial[pixel] << 1
                        )
                    ) &
                    SIN_MASK
                ];


            // ------------------------------------------------
            // Fine interference wave
            // ------------------------------------------------

            var fine =
                sinTable[
                    (
                        yp2 +
                        xPhase1[x] -
                        t3
                    ) &
                    SIN_MASK
                ];


            /*
                Combine fields.

                Each sine wave is approximately -1..1.

                Weighted combination gives about -5..5,
                then transform into palette coordinates.
            */

            var intensity =
                wave1 * 1.2 +
                wave2 * 0.9 +
                wave3 * 1.3 +
                spiral * 1.5 +
                fine * 0.6;


            /*
                Convert to palette index.

                Animation time is added once again here so the
                colors themselves appear to flow through the
                geometry.
            */

            var color =
                (
                    intensity * 28 +
                    128 +
                    frameIndex * 2
                ) & 255;


            packed[output++] =
                packedBG[color];


            packed[output++] =
                packedRA[color];


            ++pixel;
        }
    }


    return packed.join("");
}
