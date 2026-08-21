function RenderFrame(frameIndex)
{
    var p = 0;
    var t = frameIndex;

    for (var y = 0; y < height; ++y)
    {
        for (var x = 0; x < width; ++x)
        {
            var r = (x + t) & 255;
            var g = (y + t) & 255;
            var b = ((x ^ y) + t) & 255;

            // BGRA
            pixels[p++] = b;
            pixels[p++] = g;
            pixels[p++] = r;
            pixels[p++] = 255;
        }
    }
}
