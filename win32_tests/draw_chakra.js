function RenderFrame(time)
{
    var p = 0;

    // Convert elapsed seconds into a byte-like animation phase.
    // 60.0 controls speed; increase or decrease to taste.
    var t = (time * 60.0) | 0;

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
