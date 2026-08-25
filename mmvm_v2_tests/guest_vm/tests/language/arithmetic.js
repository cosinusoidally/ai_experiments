var precedence = 2 + 3 * 4;
assertEqual(precedence, 14, "multiplication precedence");
assertEqual((2 + 3) * 4, 20, "parenthesized addition");
assertEqual(17 % 5, 2, "remainder");
assertEqual("guest" + " vm", "guest vm", "string addition");
assertEqual(4 === 4, true, "strict equality");
assertEqual(4 !== 5, true, "strict inequality");
assertEqual(4 < 5 && 8 >= 8, true, "relational and logical operators");
