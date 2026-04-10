function calc_(a, b, tmp1, tmp2) {
    tmp1 = add(a, b);
    tmp2 = mul(tmp1, 6);
    return tmp2;
}

function calc(a, b) {
    return calc_(a, b, 0, 0);
}

function main() {
    return calc(3, 4);
}
