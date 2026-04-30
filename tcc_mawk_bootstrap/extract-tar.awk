BEGIN {
    if (ARGC != 3) {
        print "usage: mawk -f extract-tar.awk <tarfile> <destdir>" > "/dev/stderr"
        exit 1
    }

    tarfile = ARGV[1]
    destdir = ARGV[2]
    delete ARGV[1]
    delete ARGV[2]

    if (!is_file(tarfile)) {
        fail("missing tar file: " tarfile)
    }

    run("mkdir -p \"" destdir "\"")

    b64cmd = encoder_cmd(tarfile)
    pending = ""
    decoded_len = 0
    decoded_pos = 1

    while (read_block(block)) {
        if (is_zero_block(block)) {
            break
        }

        name = tar_string(block, 1, 100)
        prefix = tar_string(block, 346, 155)
        if (prefix != "") {
            name = prefix "/" name
        }

        size = tar_octal(block, 125, 12)
        mode = tar_octal(block, 101, 8)
        typeflag = block[157]
        outpath = destdir "/" name

        if (typeflag == 0 || typeflag == 48) {
            write_file(outpath, size, mode)
        } else if (typeflag == 53) {
            run("mkdir -p \"" outpath "\"")
            set_mode(outpath, mode)
        } else {
            skip_bytes(size)
            skip_padding(size)
            fail("unsupported tar entry type for " name)
        }
    }

    close(b64cmd)
}

function fail(msg) {
    print msg > "/dev/stderr"
    exit 1
}

function run(cmd, rc) {
    print cmd
    rc = system(cmd)
    if (rc != 0) {
        fail("command failed: " cmd)
    }
}

function is_file(path) {
    return system("[ -f \"" path "\" ]") == 0
}

function shell_quote(s,    out) {
    out = s
    gsub(/'/, "'\"'\"'", out)
    return "'" out "'"
}

function base_name(path,    out) {
    out = path
    sub(/^.*\//, "", out)
    return out
}

function encoder_cmd(path,    mode, name) {
    mode = ENVIRON["B64ENCODER"]
    if (mode == "" || mode == "base64") {
        return "base64 " shell_quote(path)
    }
    if (mode == "uuencode") {
        name = base_name(path)
        return "uuencode --base64 " shell_quote(path) " " shell_quote(name)
    }
    fail("unsupported B64ENCODER: " mode)
}

function b64val(c) {
    return index("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", c) - 1
}

function fill_decoded(    line, q, a, b, c, d) {
    while (1) {
        if (length(pending) >= 4) {
            q = substr(pending, 1, 4)
            pending = substr(pending, 5)

            a = b64val(substr(q, 1, 1))
            b = b64val(substr(q, 2, 1))
            c = substr(q, 3, 1)
            d = substr(q, 4, 1)

            decoded[1] = a * 4 + int(b / 16)
            decoded_len = 1
            if (c != "=") {
                c = b64val(c)
                decoded[++decoded_len] = (b % 16) * 16 + int(c / 4)
                if (d != "=") {
                    d = b64val(d)
                    decoded[++decoded_len] = (c % 4) * 64 + d
                }
            }
            decoded_pos = 1
            return 1
        }

        if ((b64cmd | getline line) <= 0) {
            return 0
        }
        if (line ~ /^begin-base64 / || line == "====") {
            continue
        }
        gsub(/[^A-Za-z0-9+\/=]/, "", line)
        if (line == "") {
            continue
        }
        pending = pending line
    }
}

function next_byte(    ok, b) {
    if (decoded_pos > decoded_len) {
        ok = fill_decoded()
        if (!ok) {
            return -1
        }
    }
    b = decoded[decoded_pos]
    decoded_pos++
    return b
}

function read_block(block,    i, b) {
    b = next_byte()
    if (b < 0) {
        return 0
    }
    block[1] = b
    for (i = 2; i <= 512; ++i) {
        b = next_byte()
        if (b < 0) {
            fail("short tar block")
        }
        block[i] = b
    }
    return 1
}

function is_zero_block(block,    i) {
    for (i = 1; i <= 512; ++i) {
        if (block[i] != 0) {
            return 0
        }
    }
    return 1
}

function tar_string(block, start, len,    i, s, b) {
    s = ""
    for (i = 0; i < len; ++i) {
        b = block[start + i]
        if (b == 0) {
            break
        }
        s = s sprintf("%c", b)
    }
    return s
}

function tar_octal(block, start, len,    i, s, b) {
    s = ""
    for (i = 0; i < len; ++i) {
        b = block[start + i]
        if (b == 0 || b == 32) {
            continue
        }
        s = s sprintf("%c", b)
    }
    if (s == "") {
        return 0
    }
    return octal_to_num(s)
}

function octal_to_num(s,    i, n, c) {
    n = 0
    for (i = 1; i <= length(s); ++i) {
        c = substr(s, i, 1)
        if (c < "0" || c > "7") {
            continue
        }
        n = n * 8 + (c + 0)
    }
    return n
}

function parent_dir(path,    out) {
    if (path !~ /\//) {
        return ""
    }
    out = path
    sub(/\/[^\/]+$/, "", out)
    return out
}

function skip_bytes(n,    i, b) {
    for (i = 0; i < n; ++i) {
        b = next_byte()
        if (b < 0) {
            fail("unexpected EOF while skipping data")
        }
    }
}

function skip_padding(size,    pad) {
    pad = size % 512
    if (pad != 0) {
        skip_bytes(512 - pad)
    }
}

function tar_mode_string(mode) {
    return sprintf("%04o", mode)
}

function set_mode(path, mode) {
    run("chmod " tar_mode_string(mode) " \"" path "\"")
}

function write_file(path, size, mode,    i, b, dir) {
    dir = parent_dir(path)
    if (dir != "") {
        run("mkdir -p \"" dir "\"")
    }
    run(": > \"" path "\"")
    for (i = 0; i < size; ++i) {
        b = next_byte()
        if (b < 0) {
            fail("unexpected EOF while reading file data")
        }
        printf "%c", b >> path
    }
    close(path)
    set_mode(path, mode)
    skip_padding(size)
}
