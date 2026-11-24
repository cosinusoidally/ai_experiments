var total = 0;
for (var index = 0; index < 5; index++) {
    total += index;
}
assertEqual(total, 10, "for loop accumulation");

var countdown = 3;
var visits = 0;
while (countdown > 0) {
    visits = visits + 1;
    countdown--;
}
assertEqual(visits, 3, "while loop");

var branch = 0;
if (total === 10) {
    branch = 1;
} else {
    branch = 2;
}
assertEqual(branch, 1, "if statement");
