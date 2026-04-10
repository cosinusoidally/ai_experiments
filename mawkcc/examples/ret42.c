var answer;
var i;

function times(a, b) {
    return mul(a, b);
}

function main() {
    answer = 0;
    i = 0;
    while (lt(i, 10)) {
        if (eq(i, 6)) {
            answer = times(6, 7);
            break;
        } else if (eq(i, 3)) {
            answer = 11;
        } else {
            answer = 7;
        }
        i = add(i, 1);
    }
    return answer;
}
