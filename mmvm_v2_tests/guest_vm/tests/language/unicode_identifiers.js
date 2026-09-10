var \u03B1 = 7;
var a\u0301 = 11;
var \u2160 = 13;
var digit\u0661 = 17;
var connector\u203Fname = 19;
var joiner\u200Cname = 23;

assertEqual(\u03B1 + a\u0301 + \u2160, 31,
            "Unicode letters and combining identifier parts");
assertEqual(digit\u0661 + connector\u203Fname + joiner\u200Cname, 59,
            "Unicode digit, connector, and joiner identifier parts");
