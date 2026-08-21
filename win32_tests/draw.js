var pixelCount = width * height;

// Reused working array.
// Two UTF-16 characters per BGRA pixel.
var packed = new Array(pixelCount * 2);

var blue = 128;
var opaque = 255 << 8;

function RenderFrame(frameIndex)
{
    var output = 0;
    var f = frameIndex & 255;

    for (var y = 0; y < height; ++y)
    {
        var g = (y + f) & 255;
        var bg = blue | (g << 8);

        for (var x = 0; x < width; ++x)
        {
            var r = (x + f) & 255;

            // B, G
            packed[output++] =
                String.fromCharCode(bg);

            // R, A
            packed[output++] =
                String.fromCharCode(
                    r | opaque
                );
        }
    }

    return packed.join("");
}
