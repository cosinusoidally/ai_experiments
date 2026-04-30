BEGIN {
    RETVAL_LAST_BLOCK = -100
    RETVAL_NOT_BZIP_DATA = -1
    RETVAL_DATA_ERROR = -2
    RETVAL_OBSOLETE_INPUT = -3

    MAX_GROUPS = 6
    GROUP_SIZE = 50
    MAX_HUFCODE_BITS = 20
    MAX_SYMBOLS = 258
    SYMBOL_RUNA = 0
    SYMBOL_RUNB = 1

    if (ARGC != 3) {
        print "usage: mawk -f extract-bz2.awk <src.bz2> <out.tar>" > "/dev/stderr"
        exit 1
    }

    src = ARGV[1]
    out = ARGV[2]
    delete ARGV[1]
    delete ARGV[2]

    if (!is_file(src)) {
        fail("missing bz2 file: " src)
    }

    run("mkdir -p \"" parent_dir_or_dot(out) "\"")
    run(": > \"" out "\"")

    init_input(src)
    start_bunzip()
    rc = bunzip_to_file(out)
    close(out)
    close(b64cmd)

    if (rc != 0) {
        fail("bunzip failed with status " rc)
    }
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

function parent_dir_or_dot(path, outp) {
    outp = path
    sub(/\/[^\/]+$/, "", outp)
    if (outp == path || outp == "") {
        return "."
    }
    return outp
}

function b64val(c) {
    return index("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", c) - 1
}

function init_input(path) {
    b64cmd = "base64 \"" path "\""
    pending = ""
    decoded_len = 0
    decoded_pos = 1
    inbufBitCount = 0
    inbufBits = 0
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
        gsub(/[^A-Za-z0-9+\/=]/, "", line)
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

function get_bits(bits_wanted,    bits, nextb) {
    bits = 0
    while (inbufBitCount < bits_wanted) {
        nextb = next_byte()
        if (nextb < 0) {
            fail("unexpected EOF in compressed stream")
        }

        if (inbufBitCount >= 24) {
            bits = mod_pow2(inbufBits, inbufBitCount)
            bits_wanted -= inbufBitCount
            bits *= pow2(bits_wanted)
            inbufBitCount = 0
            inbufBits = 0
        }

        if (inbufBitCount == 0) {
            inbufBits = 0
        } else {
            inbufBits = mod_pow2(inbufBits, inbufBitCount)
        }
        inbufBits = inbufBits * 256 + nextb
        inbufBitCount += 8
    }

    inbufBitCount -= bits_wanted
    bits += mod_pow2(rshift(inbufBits, inbufBitCount), bits_wanted)
    return bits
}

function pow2(n,    i, p) {
    p = 1
    for (i = 0; i < n; ++i) {
        p *= 2
    }
    return p
}

function lshift(v, n) {
    return v * pow2(n)
}

function rshift(v, n) {
    return int(v / pow2(n))
}

function mod_pow2(v, n) {
    return v - int(v / pow2(n)) * pow2(n)
}

function bit_is_set(v, n) {
    return int(v / pow2(n)) % 2
}

function clear_block_state(    i, g, s) {
    delete symToByte
    delete selectors
    delete lengths
    delete tempCount
    delete byteCount
    delete groupMinLen
    delete groupMaxLen
    delete groupLimit
    delete groupBase
    delete groupPermute
    delete dbuf

    for (i = 0; i < 255; ++i) {
        mtfSymbol[i] = 0
    }
    for (g = 0; g < MAX_GROUPS; ++g) {
        for (s = 0; s <= MAX_HUFCODE_BITS + 1; ++s) {
            groupLimit[g, s] = 0
            groupBase[g, s] = 0
        }
        for (s = 0; s < MAX_SYMBOLS; ++s) {
            groupPermute[g, s] = 0
        }
    }
}

function start_bunzip(    level, i) {
    totalCRC = 0

    if (get_bits(8) != 66 || get_bits(8) != 90 || get_bits(8) != 104) {
        fail("not bzip2 data")
    }

    level = get_bits(8)
    if (level < 49 || level > 57) {
        fail("invalid bzip2 block size")
    }

    dbufSize = 100000 * (level - 48)

    for (i = 0; i < 255; ++i) {
        crcTable[i] = 0
    }
    crc_init()
}

function crc_init(    i, j, c) {
    for (i = 0; i < 256; ++i) {
        c = lshift(i, 24)
        for (j = 8; j > 0; --j) {
            if (bit_is_set(c, 31)) {
                c = mod32(lshift(c, 1) + 79764919)
            } else {
                c = mod32(lshift(c, 1))
            }
        }
        crcTable[i] = c
    }
}

function mod32(v) {
    while (v < 0) {
        v += 4294967296
    }
    while (v >= 4294967296) {
        v -= 4294967296
    }
    return v
}

function read_block_header(    ii, jj, hh, kk, symCount, uc, g, s, pos, minLen, maxLen, pp, runbits) {
    clear_block_state()

    ii = get_bits(24)
    jj = get_bits(24)
    headerCRC = get_bits(32)

    if (ii == 1536581 && jj == 3690640) {
        streamCRC = headerCRC
        return RETVAL_LAST_BLOCK
    }

    if (ii != 3227993 || jj != 2511705) {
        return RETVAL_NOT_BZIP_DATA
    }

    if (get_bits(1) != 0) {
        return RETVAL_OBSOLETE_INPUT
    }

    origPtr = get_bits(24)
    if (origPtr > dbufSize) {
        return RETVAL_DATA_ERROR
    }

    hh = get_bits(16)
    symTotal = 0
    for (ii = 0; ii < 16; ++ii) {
        if (bit_is_set(hh, 15 - ii)) {
            kk = get_bits(16)
            for (jj = 0; jj < 16; ++jj) {
                if (bit_is_set(kk, 15 - jj)) {
                    symToByte[symTotal] = 16 * ii + jj
                    ++symTotal
                }
            }
        }
    }

    groupCount = get_bits(3)
    if (groupCount < 2 || groupCount > MAX_GROUPS) {
        return RETVAL_DATA_ERROR
    }

    nSelectors = get_bits(15)
    if (nSelectors < 1) {
        return RETVAL_DATA_ERROR
    }

    for (ii = 0; ii < groupCount; ++ii) {
        mtfSymbol[ii] = ii
    }

    for (ii = 0; ii < nSelectors; ++ii) {
        jj = 0
        while (get_bits(1)) {
            ++jj
            if (jj >= groupCount) {
                return RETVAL_DATA_ERROR
            }
        }
        uc = mtfSymbol[jj]
        while (jj > 0) {
            mtfSymbol[jj] = mtfSymbol[jj - 1]
            --jj
        }
        mtfSymbol[0] = uc
        selectors[ii] = uc
    }

    symCount = symTotal + 2
    for (g = 0; g < groupCount; ++g) {
        hh = get_bits(5)
        for (ii = 0; ii < symCount; ++ii) {
            while (1) {
                if (hh < 1 || hh > MAX_HUFCODE_BITS) {
                    return RETVAL_DATA_ERROR
                }
                if (get_bits(1) == 0) {
                    break
                }
                if (get_bits(1) == 0) {
                    ++hh
                } else {
                    --hh
                }
            }
            lengths[ii] = hh
        }

        minLen = lengths[0]
        maxLen = lengths[0]
        for (ii = 1; ii < symCount; ++ii) {
            if (lengths[ii] < minLen) {
                minLen = lengths[ii]
            }
            if (lengths[ii] > maxLen) {
                maxLen = lengths[ii]
            }
        }
        groupMinLen[g] = minLen
        groupMaxLen[g] = maxLen

        for (ii = 0; ii <= MAX_HUFCODE_BITS; ++ii) {
            tempCount[ii] = 0
            groupLimit[g, ii] = 0
            groupBase[g, ii] = 0
        }

        pp = 0
        for (ii = minLen; ii <= maxLen; ++ii) {
            for (jj = 0; jj < symCount; ++jj) {
                if (lengths[jj] == ii) {
                    groupPermute[g, pp] = jj
                    ++pp
                }
            }
        }

        for (ii = 0; ii < symCount; ++ii) {
            ++tempCount[lengths[ii]]
        }

        pp = 0
        hh = 0
        for (ii = minLen; ii < maxLen; ++ii) {
            pp += tempCount[ii]
            groupLimit[g, ii] = pp - 1
            pp *= 2
            hh += tempCount[ii]
            groupBase[g, ii + 1] = pp - hh
        }
        groupLimit[g, maxLen] = pp + tempCount[maxLen] - 1
        groupLimit[g, maxLen + 1] = 2147483647
        groupBase[g, minLen] = 0
    }

    return 0
}

function read_huffman_symbol(g,    ii, jj, kk) {
    ii = groupMinLen[g]
    jj = get_bits(ii)
    while (jj > groupLimit[g, ii]) {
        ++ii
        if (ii > groupMaxLen[g] + 1) {
            return -1
        }
        kk = get_bits(1)
        jj = jj * 2 + kk
    }
    jj -= groupBase[g, ii]
    if (ii > groupMaxLen[g] || jj < 0 || jj >= MAX_SYMBOLS) {
        return -1
    }
    return groupPermute[g, jj]
}

function read_huffman_data(    ii, jj, runPos, dbufCount, symLeft, selector, g, nextSym, hh, uc) {
    for (ii = 0; ii < 256; ++ii) {
        byteCount[ii] = 0
        mtfSymbol[ii] = ii
    }

    runPos = 0
    dbufCount = 0
    symLeft = 0
    selector = 0

    while (1) {
        if (symLeft == 0) {
            if (selector >= nSelectors) {
                return RETVAL_DATA_ERROR
            }
            g = selectors[selector]
            ++selector
            symLeft = GROUP_SIZE
        }
        --symLeft

        nextSym = read_huffman_symbol(g)
        if (nextSym < 0) {
            return RETVAL_DATA_ERROR
        }

        if (nextSym <= SYMBOL_RUNB) {
            if (runPos == 0) {
                runPos = 1
                hh = 0
            }
            hh += runPos * (nextSym + 1)
            runPos *= 2
            continue
        }

        if (runPos != 0) {
            runPos = 0
            if (hh > dbufSize || dbufCount + hh > dbufSize) {
                return RETVAL_DATA_ERROR
            }
            uc = symToByte[mtfSymbol[0]]
            byteCount[uc] += hh
            while (hh > 0) {
                dbuf[dbufCount] = uc
                ++dbufCount
                --hh
            }
        }

        if (nextSym > symTotal) {
            break
        }

        if (dbufCount >= dbufSize) {
            return RETVAL_DATA_ERROR
        }

        ii = nextSym - 1
        uc = mtfSymbol[ii]
        while (ii > 0) {
            mtfSymbol[ii] = mtfSymbol[ii - 1]
            --ii
        }
        mtfSymbol[0] = uc
        uc = symToByte[uc]
        ++byteCount[uc]
        dbuf[dbufCount] = uc
        ++dbufCount
    }

    writeCount = dbufCount
    if (origPtr >= writeCount) {
        return RETVAL_DATA_ERROR
    }
    return 0
}

function burrows_wheeler_prep(    ii, jj, kk, uc) {
    jj = 0
    for (ii = 0; ii < 256; ++ii) {
        kk = jj + byteCount[ii]
        byteCount[ii] = jj
        jj = kk
    }

    for (ii = 0; ii < writeCount; ++ii) {
        uc = mod_pow2(dbuf[ii], 8)
        dbuf[byteCount[uc]] += ii * 256
        ++byteCount[uc]
    }
}

function write_bunzip_block(path,    count, pos, current, run_count, previous, copies, outbyte) {
    if (writeCount > 0) {
        writePos = dbuf[origPtr]
        writeCurrent = mod_pow2(writePos, 8)
        writePos = rshift(writePos, 8)
        writeRun = -1
    }

    count = writeCount
    pos = writePos
    current = writeCurrent
    run_count = writeRun

    while (count > 0) {
        --count
        previous = current
        pos = dbuf[pos]
        current = mod_pow2(pos, 8)
        pos = rshift(pos, 8)

        if (run_count == 3) {
            run_count = 4
            copies = current
            outbyte = previous
            current = -1
        } else {
            ++run_count
            copies = 1
            outbyte = current
        }

        while (copies > 0) {
            printf "%c", outbyte >> path
            --copies
        }

        if (current != previous) {
            run_count = 0
        }
    }
    close(path)
}

function bunzip_to_file(path,    rc) {
    while (1) {
        rc = read_block_header()
        if (rc == RETVAL_LAST_BLOCK) {
            return 0
        }
        if (rc != 0) {
            return rc
        }

        rc = read_huffman_data()
        if (rc != 0) {
            return rc
        }

        burrows_wheeler_prep()
        write_bunzip_block(path)
    }
}
