BEGIN {
    init_host()
    if (SOURCE == "") {
        SOURCE = "jsvm_self.c"
    }
    if (OUT == "") {
        OUT = "artifacts/jsvm.awk.exe"
    }

    argv = brk(8)
    wi32(argv, mks("jsvm-awk"))
    wi32(ADD(argv, 4), mks(SOURCE))
    status = main(2, argv)
    if (status != 0) {
        exit status
    }
    exit 0
}

function init_host(i) {
    heap_top = 1
    next_fd = 3
    for (i = 1; i < 256; i = i + 1) {
        ord[sprintf("%c", i)] = i
    }
    ord[""] = 0
}

function to_u32(x) {
    x = x % 4294967296
    if (x < 0) {
        x = x + 4294967296
    }
    return x
}

function to_i32(x) {
    x = to_u32(x)
    if (x >= 2147483648) {
        x = x - 4294967296
    }
    return x
}

function cstr(ptr, s, ch) {
    s = ""
    while (ri8(ptr) != 0) {
        ch = ri8(ptr)
        s = s sprintf("%c", ch)
        ptr = ptr + 1
    }
    return s
}

function brk(n, p) {
    p = heap_top
    heap_top = heap_top + n
    return p
}

function ri8(p) {
    if ((p in heap) == 0) {
        return 0
    }
    return heap[p]
}

function wi8(p, v) {
    v = to_u32(v) % 256
    heap[p] = v
    return v
}

function ri32(p, v) {
    v = ri8(p) + (ri8(p + 1) * 256) + (ri8(p + 2) * 65536) + (ri8(p + 3) * 16777216)
    return to_i32(v)
}

function wi32(p, v, u) {
    u = to_u32(v)
    wi8(p, u % 256)
    u = int(u / 256)
    wi8(p + 1, u % 256)
    u = int(u / 256)
    wi8(p + 2, u % 256)
    u = int(u / 256)
    wi8(p + 3, u % 256)
    return to_i32(v)
}

function mks(s, p, i, ch) {
    if (s in string_cache) {
        return string_cache[s]
    }
    p = brk(length(s) + 1)
    for (i = 1; i <= length(s); i = i + 1) {
        ch = substr(s, i, 1)
        wi8(p + i - 1, ord[ch])
    }
    wi8(p + length(s), 0)
    string_cache[s] = p
    return p
}

function mkC(s) {
    return ord[substr(s, 1, 1)]
}

function open(path, flags, mode, name, fd, line, n, i, ch) {
    name = cstr(path)
    fd = next_fd
    next_fd = next_fd + 1
    file_len[fd] = 0
    file_pos[fd] = 0
    while ((getline line < name) > 0) {
        n = length(line)
        for (i = 1; i <= n; i = i + 1) {
            ch = substr(line, i, 1)
            file_byte[fd, file_len[fd]] = ord[ch]
            file_len[fd] = file_len[fd] + 1
        }
        file_byte[fd, file_len[fd]] = 10
        file_len[fd] = file_len[fd] + 1
    }
    return fd
}

function read(fd, buf, len, n, i) {
    if ((fd in file_len) == 0) {
        return -1
    }
    n = len
    if (n > file_len[fd] - file_pos[fd]) {
        n = file_len[fd] - file_pos[fd]
    }
    for (i = 0; i < n; i = i + 1) {
        wi8(buf + i, file_byte[fd, file_pos[fd] + i])
    }
    file_pos[fd] = file_pos[fd] + n
    return n
}

function write(fd, buf, len, i, s) {
    if (fd == 1) {
        for (i = 0; i < len; i = i + 1) {
            printf "%c", ri8(buf + i) > OUT
        }
        return len
    }
    if (fd == 2) {
        s = ""
        for (i = 0; i < len; i = i + 1) {
            s = s sprintf("%c", ri8(buf + i))
        }
        printf "%s", s > "/dev/stderr"
        return len
    }
    return -1
}

function add(a, b) { return to_i32(a + b) }
function ADD(a, b) { return to_i32(a + b) }
function SUB(a, b) { return to_i32(a - b) }
function mul(a, b) { return to_i32(a * b) }
function MUL(a, b) { return to_i32(a * b) }
function div(a, b) { return to_i32(int(a / b)) }
function DIV(a, b) { return to_i32(int(a / b)) }
function mod(a, b) { return to_i32(a - (int(a / b) * b)) }
function MOD(a, b) { return to_i32(a - (int(a / b) * b)) }
function neg(a) { return to_i32(-a) }
function NEG(a) { return to_i32(-a) }
function not(a) { return a ? 0 : 1 }
function NOT(a) { return a ? 0 : 1 }
function eq(a, b) { return a == b ? 1 : 0 }
function EQ(a, b) { return a == b ? 1 : 0 }
function ne(a, b) { return a != b ? 1 : 0 }
function NE(a, b) { return a != b ? 1 : 0 }
function lt(a, b) { return a < b ? 1 : 0 }
function LT(a, b) { return a < b ? 1 : 0 }
function le(a, b) { return a <= b ? 1 : 0 }
function LE(a, b) { return a <= b ? 1 : 0 }
function gt(a, b) { return a > b ? 1 : 0 }
function GT(a, b) { return a > b ? 1 : 0 }
function ge(a, b) { return a >= b ? 1 : 0 }
function GE(a, b) { return a >= b ? 1 : 0 }

function and(a, b, ua, ub, r, bit) {
    ua = to_u32(a)
    ub = to_u32(b)
    r = 0
    bit = 1
    while (bit < 4294967296) {
        if ((ua % 2) && (ub % 2)) {
            r = r + bit
        }
        ua = int(ua / 2)
        ub = int(ub / 2)
        bit = bit * 2
    }
    return to_i32(r)
}

function AND(a, b) {
    return and(a, b)
}

function or(a, b, ua, ub, r, bit) {
    ua = to_u32(a)
    ub = to_u32(b)
    r = 0
    bit = 1
    while (bit < 4294967296) {
        if ((ua % 2) || (ub % 2)) {
            r = r + bit
        }
        ua = int(ua / 2)
        ub = int(ub / 2)
        bit = bit * 2
    }
    return to_i32(r)
}

function OR(a, b) {
    return or(a, b)
}

function xor(a, b, ua, ub, r, bit) {
    ua = to_u32(a)
    ub = to_u32(b)
    r = 0
    bit = 1
    while (bit < 4294967296) {
        if ((ua % 2) != (ub % 2)) {
            r = r + bit
        }
        ua = int(ua / 2)
        ub = int(ub / 2)
        bit = bit * 2
    }
    return to_i32(r)
}

function XOR(a, b) {
    return xor(a, b)
}

function shl(a, b, i, r) {
    b = to_u32(b) % 32
    r = to_u32(a)
    for (i = 0; i < b; i = i + 1) {
        r = (r * 2) % 4294967296
    }
    return to_i32(r)
}

function SHL(a, b) {
    return shl(a, b)
}

function shr(a, b, i, r) {
    b = to_u32(b) % 32
    r = to_u32(a)
    for (i = 0; i < b; i = i + 1) {
        r = int(r / 2)
    }
    return to_i32(r)
}

function SHR(a, b) {
    return shr(a, b)
}
