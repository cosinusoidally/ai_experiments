/* Original minimal self-hosting C-subset compiler, emitting Linux/i386 ELF.
 * Usage: cc_min source.c output.elf
 * No libc, subprocess, assembler, linker, timestamps, or embedded compiler image.
 * The bootstrap-only block implements the same primitives the compiler emits.
 */
#ifdef __TINYC__
int expression(int minimum);
int load8(int p) { return *(unsigned char *)p; }
int load32(int p) { return *(int *)p; }
int store8(int p, int v) { *(unsigned char *)p = v; return v; }
int store32(int p, int v) { *(int *)p = v; return v; }
int syscall3(int n, int a, int b, int c) {
    int r;
    __asm__ __volatile__("int $0x80" : "=a"(r) : "0"(n), "b"(a), "c"(b), "d"(c) : "memory", "cc");
    return r;
}
__asm__(".text\n.globl _start\n_start:\nmovl (%esp), %eax\nleal 4(%esp), %edx\n"
        "pushl %edx\npushl %eax\ncall main\nmovl %eax, %ebx\nmovl $1, %eax\nint $0x80\nud2\n");
#endif

int source;
int machine;
int strings;
int names;
int token_text;
int digits;
int symbol_name;
int symbol_kind;
int symbol_address;
int symbol_head;
int symbol_arity;
int local_name;
int local_offset;
int local_kind;
int source_size;
int position;
int line;
int token;
int token_value;
int token_string;
int string_size;
int name_size;
int symbol_count;
int local_count;
int local_bytes;
int code_size;
int data_size;
int expression_kind;
int heap_end;
int reloc_position;
int reloc_offset;
int reloc_kind;
int data_base;
int global_base;

/* Growable vectors have data, length, capacity and element-width words.
 * brk allocations remain owned until process exit; no resource-size ceilings.
 */
int allocation_failure() {
    syscall3(4, 2, (int)"cc_min: allocation failed\n", 26);
    syscall3(1, 1, 0, 0);
    return 0;
}
int allocate(int bytes) {
    int p;
    int end;
    if (bytes < 0 || bytes > 0x7fffffff - heap_end - 3) allocation_failure();
    p = heap_end;
    end = (p + bytes + 3) & -4;
    if (syscall3(45, end, 0, 0) != end) allocation_failure();
    heap_end = end;
    return p;
}
int vec_new(int width) {
    int v;
    v = allocate(16);
    store32(v, 0); store32(v + 4, 0); store32(v + 8, 0); store32(v + 12, width);
    return v;
}
int vec_data(int v) { return load32(v); }
int vec_get(int v, int index) {
    if (index < 0 || index >= load32(v + 4)) return 0;
    if (load32(v + 12) == 1) return load8(load32(v) + index);
    return load32(load32(v) + index * 4);
}
int vec_set(int v, int index, int value) {
    int capacity;
    int width;
    int old;
    int fresh;
    int i;
    int used;
    width = load32(v + 12); capacity = load32(v + 8); used = load32(v + 4);
    if (index < 0 || index >= 0x7fffffff / width) allocation_failure();
    if (index >= capacity) {
        if (!capacity) capacity = 16;
        while (capacity <= index) {
            if (capacity > 0x7fffffff / width / 2) { capacity = index + 1; }
            else capacity = capacity * 2;
        }
        old = load32(v); fresh = allocate(capacity * width);
        i = 0;
        while (i < used * width) { store8(fresh + i, load8(old + i)); i = i + 1; }
        store32(v, fresh); store32(v + 8, capacity);
    }
    i = used;
    while (i <= index) {
        if (width == 1) store8(load32(v) + i, 0);
        else store32(load32(v) + i * 4, 0);
        i = i + 1;
    }
    if (index >= used) store32(v + 4, index + 1);
    if (width == 1) store8(load32(v) + index, value);
    else store32(load32(v) + index * 4, value);
    return value;
}
int initialize() {
    heap_end = syscall3(45, 0, 0, 0);
    source = vec_new(1);
    machine = vec_new(1);
    strings = vec_new(1);
    names = vec_new(1);
    token_text = vec_new(1);
    digits = vec_new(1);
    symbol_name = vec_new(4);
    symbol_kind = vec_new(4);
    symbol_address = vec_new(4);
    symbol_head = vec_new(4);
    symbol_arity = vec_new(4);
    local_name = vec_new(4);
    local_offset = vec_new(4);
    local_kind = vec_new(4);
    reloc_position = vec_new(4);
    reloc_offset = vec_new(4);
    reloc_kind = vec_new(4);
    return 0;
}

int text_length(int p) {
    int n;
    n = 0;
    while (load8(p + n)) n = n + 1;
    return n;
}

int same_text(int a, int b) {
    int i;
    i = 0;
    while (load8(a + i) && load8(a + i) == load8(b + i)) i = i + 1;
    return load8(a + i) == load8(b + i);
}

int print_text(int p) {
    return syscall3(4, 2, p, text_length(p));
}

int die(int message) {
    int n;
    int i;
    print_text((int)"cc_min: ");
    print_text(message);
    print_text((int)" at line ");
    n = line;
    i = 0;
    while (n || !i) {
        vec_set(digits, i, '0' + n % 10);
        i = i + 1; n = n / 10;
    }
    while (i) { i = i - 1; syscall3(4, 2, vec_data(digits) + i, 1); }
    print_text((int)"\n");
    syscall3(1, 1, 0, 0);
    return 0;
}

int emit(int b) {
    vec_set(machine, code_size, b);
    code_size = code_size + 1;
    return 0;
}

int word(int v) {
    emit(v & 255);
    emit((v >> 8) & 255);
    emit((v >> 16) & 255);
    emit((v >> 24) & 255);
    return 0;
}

int put32(int p, int v) {
    store32(vec_data(machine) + p, v);
    return 0;
}

int immediate(int op, int v) {
    emit(op);
    word(v);
    return 0;
}

int data_immediate(int offset, int kind) {
    int n;
    n = load32(reloc_position + 4);
    emit(184);
    vec_set(reloc_position, n, code_size);
    vec_set(reloc_offset, n, offset);
    vec_set(reloc_kind, n, kind);
    word(0);
    return 0;
}

int branch(int op) {
    int p;
    if (op == 233) emit(233);
    else { emit(15); emit(op); }
    p = code_size;
    word(0);
    return p;
}

int resolve_branch(int p, int target) {
    put32(p, target - p - 4);
    return 0;
}

int intern(int name) {
    int i;
    int n;
    i = 1;
    while (i <= symbol_count) {
        if (same_text(vec_data(names) + vec_get(symbol_name, i), name)) return i;
        i = i + 1;
    }
    n = text_length(name) + 1;
    symbol_count = symbol_count + 1;
    vec_set(symbol_name, symbol_count, name_size);
    vec_set(symbol_arity, symbol_count, -1);
    i = 0;
    while (i < n) { vec_set(names, name_size + i, load8(name + i)); i = i + 1; }
    name_size = name_size + n;
    return symbol_count;
}

int define_function(int id, int arity) {
    int p;
    int next;
    if (vec_get(symbol_address, id)) die((int)"duplicate function");
    if (vec_get(symbol_kind, id) && vec_get(symbol_kind, id) != 1) die((int)"function conflicts with variable");
    if (vec_get(symbol_arity, id) != -1 && vec_get(symbol_arity, id) != arity) die((int)"function argument count mismatch");
    vec_set(symbol_kind, id, 1);
    vec_set(symbol_arity, id, arity);
    vec_set(symbol_address, id, 0x08048000 + code_size);
    p = vec_get(symbol_head, id);
    while (p) {
        next = load32(vec_data(machine) + p);
        put32(p, vec_get(symbol_address, id) - 0x08048000 - p - 4);
        p = next;
    }
    vec_set(symbol_head, id, 0);
    return 0;
}

int call_function(int id, int count) {
    int p;
    if (vec_get(symbol_kind, id) && vec_get(symbol_kind, id) != 1) die((int)"called a non-function");
    if (vec_get(symbol_arity, id) != -1 && vec_get(symbol_arity, id) != count) die((int)"function argument count mismatch");
    vec_set(symbol_kind, id, 1);
    vec_set(symbol_arity, id, count);
    emit(232);
    p = code_size;
    if (vec_get(symbol_address, id)) word(vec_get(symbol_address, id) - 0x08048000 - p - 4);
    else { word(vec_get(symbol_head, id)); vec_set(symbol_head, id, p); }
    return 0;
}

int escape_character() {
    int c;
    if (position >= source_size) die((int)"unfinished escape");
    c = vec_get(source, position);
    position = position + 1;
    if (c == 'n') return 10;
    if (c == 'r') return 13;
    if (c == 't') return 9;
    if (c == '0') return 0;
    if (c == '\\' || c == '\'' || c == '"') return c;
    die((int)"unsupported escape");
    return 0;
}

int identifier_character(int c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || (c >= '0' && c <= '9');
}

int lex() {
    int c;
    int d;
    int n;
    int base;
    int done;
    done = 0;
    while (!done) {
        if (position >= source_size) { token = 0; return 0; }
        c = vec_get(source, position);
        if (c <= 32) {
            if (c == 10) line = line + 1;
            position = position + 1;
        } else if (c == '/' && vec_get(source, position + 1) == '/') {
            while (position < source_size && vec_get(source, position) != 10) position = position + 1;
        } else if (c == '/' && vec_get(source, position + 1) == '*') {
            position = position + 2;
            while (position < source_size && !(vec_get(source, position) == '*' && vec_get(source, position + 1) == '/')) {
                if (vec_get(source, position) == 10) line = line + 1;
                position = position + 1;
            }
            if (position >= source_size) die((int)"unfinished comment");
            position = position + 2;
        } else if (c == '#') {
            /* Only the explicitly named bootstrap-only conditional is accepted. */
            if (vec_get(source, position + 1) != 'i' || vec_get(source, position + 2) != 'f' || vec_get(source, position + 3) != 'd')
                die((int)"unsupported preprocessor directive");
            n = position;
            while (position < source_size && vec_get(source, position) != 10) position = position + 1;
            if (position - n != 16) die((int)"expected #ifdef __TINYC__");
            n = 0;
            while (n < 16) {
                if (vec_get(source, position - 16 + n) != load8((int)"#ifdef __TINYC__" + n))
                    die((int)"expected #ifdef __TINYC__");
                n = n + 1;
            }
            done = 0;
            while (!done && position < source_size) {
                if (vec_get(source, position) == 10) line = line + 1;
                if (vec_get(source, position) == '#' && vec_get(source, position + 1) == 'e' && vec_get(source, position + 2) == 'n'
                    && vec_get(source, position + 3) == 'd' && vec_get(source, position + 4) == 'i' && vec_get(source, position + 5) == 'f') {
                    while (position < source_size && vec_get(source, position) != 10) position = position + 1;
                    done = 1;
                } else position = position + 1;
            }
            if (!done) die((int)"unfinished bootstrap conditional");
            done = 0;
        } else done = 1;
    }
    c = vec_get(source, position);
    position = position + 1;
    token = c;
    if (identifier_character(c) && !(c >= '0' && c <= '9')) {
        n = 0;
        vec_set(token_text, n, c);
        n = n + 1;
        while (identifier_character(vec_get(source, position))) {
            vec_set(token_text, n, vec_get(source, position));
            n = n + 1;
            position = position + 1;
        }
        vec_set(token_text, n, 0);
        token = 256;
        if (same_text(vec_data(token_text), (int)"int")) token = 260;
        if (same_text(vec_data(token_text), (int)"char")) token = 261;
        if (same_text(vec_data(token_text), (int)"if")) token = 262;
        if (same_text(vec_data(token_text), (int)"else")) token = 263;
        if (same_text(vec_data(token_text), (int)"while")) token = 264;
        if (same_text(vec_data(token_text), (int)"return")) token = 265;
    } else if (c >= '0' && c <= '9') {
        base = 10;
        token_value = c - '0';
        if (c == '0' && (vec_get(source, position) == 'x' || vec_get(source, position) == 'X')) {
            base = 16; token_value = 0; position = position + 1;
        }
        done = 0;
        while (!done) {
            c = vec_get(source, position);
            d = -1;
            if (c >= '0' && c <= '9') d = c - '0';
            if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
            if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
            if (d < 0 || d >= base) done = 1;
            else { token_value = token_value * base + d; position = position + 1; }
        }
        token = 257;
    } else if (c == '\'') {
        if (position >= source_size) die((int)"unfinished character literal");
        token_value = vec_get(source, position); position = position + 1;
        if (token_value == '\\') token_value = escape_character();
        if (vec_get(source, position) != '\'') die((int)"expected closing character quote");
        position = position + 1; token = 257;
    } else if (c == '"') {
        token_string = string_size;
        while (position < source_size && vec_get(source, position) != '"') {
            c = vec_get(source, position); position = position + 1;
            if (c == '\\') c = escape_character();
            vec_set(strings, string_size, c); string_size = string_size + 1;
        }
        if (position >= source_size) die((int)"unfinished string literal");
        position = position + 1;
        vec_set(strings, string_size, 0); string_size = string_size + 1; token = 258;
    } else {
        d = vec_get(source, position);
        if (c == '=' && d == '=') token = 270;
        if (c == '!' && d == '=') token = 271;
        if (c == '<' && d == '=') token = 272;
        if (c == '>' && d == '=') token = 273;
        if (c == '<' && d == '<') token = 274;
        if (c == '>' && d == '>') token = 275;
        if (c == '&' && d == '&') token = 276;
        if (c == '|' && d == '|') token = 277;
        if (token >= 270) position = position + 1;
    }
    return 0;
}

int expect(int t) {
    if (token != t) die((int)"unexpected token");
    lex();
    return 0;
}

int rvalue() {
    if (expression_kind == 1) { emit(139); emit(0); }
    if (expression_kind == 2) { emit(15); emit(182); emit(0); }
    expression_kind = 0;
    return 0;
}

int priority(int t) {
    if (t == '=') return 1;
    if (t == 277) return 2;
    if (t == 276) return 3;
    if (t == '|') return 4;
    if (t == '^') return 5;
    if (t == '&') return 6;
    if (t == 270 || t == 271) return 7;
    if (t == '<' || t == '>' || t == 272 || t == 273) return 8;
    if (t == 274 || t == 275) return 9;
    if (t == '+' || t == '-') return 10;
    if (t == '*' || t == '/' || t == '%') return 11;
    return 0;
}

int boolean_value() {
    emit(133); emit(192); emit(15); emit(149); emit(192);
    emit(15); emit(182); emit(192);
    return 0;
}

int unary() {
    int op;
    int id;
    int i;
    int j;
    int count;
    int kind;
    op = token;
    if (op == '+' || op == '-' || op == '!' || op == '~' || op == '&') {
        lex(); unary();
        if (op == '&') {
            if (!expression_kind) die((int)"address of non-lvalue");
            expression_kind = 0; return 0;
        }
        rvalue();
        if (op == '-') { emit(247); emit(216); }
        if (op == '~') { emit(247); emit(208); }
        if (op == '!') {
            emit(133); emit(192); emit(15); emit(148); emit(192);
            emit(15); emit(182); emit(192);
        }
    } else if (op == '(') {
        lex();
        if (token == 260) { lex(); expect(')'); unary(); rvalue(); }
        else { expression(1); expect(')'); }
    } else if (op == 257 || op == 258) {
        if (op == 257) immediate(184, token_value);
        else data_immediate(token_string, 0);
        expression_kind = 0; lex();
    } else if (op == 256) {
        id = intern(vec_data(token_text)); lex();
        if (token == '(') {
            lex(); count = 0;
            while (token != ')') {
                expression(1); rvalue(); emit(80); count = count + 1;
                if (token != ',') { if (token != ')') die((int)"expected argument separator"); }
                else { lex(); if (token == ')') die((int)"empty argument"); }
            }
            lex();
            /* Evaluation is left-to-right; reverse the saved values for cdecl. */
            i = 0;
            while (i < count / 2) {
                j = count - 1 - i;
                emit(139); emit(132); emit(36); word(i * 4);
                emit(139); emit(140); emit(36); word(j * 4);
                emit(137); emit(140); emit(36); word(i * 4);
                emit(137); emit(132); emit(36); word(j * 4);
                i = i + 1;
            }
            call_function(id, count);
            if (count) { emit(129); emit(196); word(count * 4); }
            expression_kind = 0;
        } else {
            i = local_count - 1;
            while (i >= 0 && vec_get(local_name, i) != id) i = i - 1;
            if (i >= 0) {
                emit(141); emit(133); word(vec_get(local_offset, i)); expression_kind = vec_get(local_kind, i);
            } else {
                kind = vec_get(symbol_kind, id);
                if (kind < 2) die((int)"unknown variable");
                data_immediate(vec_get(symbol_address, id), 1); expression_kind = kind - 1;
            }
        }
    } else die((int)"expected expression");
    while (token == '[') {
        kind = expression_kind;
        if (kind != 3 && kind != 4) die((int)"indexing requires a global array");
        rvalue(); emit(80); lex(); expression(1); rvalue(); expect(']');
        if (kind == 3) { emit(193); emit(224); emit(2); }
        emit(89); emit(1); emit(200);
        if (kind == 3) expression_kind = 1;
        else expression_kind = 2;
    }
    return 0;
}

int expression(int minimum) {
    int op;
    int p;
    int kind;
    int jump;
    unary();
    while (priority(token) >= minimum) {
        op = token; p = priority(op); kind = expression_kind;
        if (op == '=') {
            if (kind != 1 && kind != 2) die((int)"assignment requires scalar lvalue");
            emit(80); lex(); expression(p); rvalue(); emit(89);
            if (kind == 1) { emit(137); emit(1); }
            else { emit(136); emit(1); }
        } else if (op == 276 || op == 277) {
            rvalue(); emit(133); emit(192);
            if (op == 276) jump = branch(132);
            else jump = branch(133);
            lex(); expression(p + 1); rvalue(); resolve_branch(jump, code_size); boolean_value();
        } else {
            rvalue(); emit(80); lex(); expression(p + 1); rvalue(); emit(89);
            if (op == '+') { emit(1); emit(200); }
            else if (op == '-') { emit(41); emit(193); emit(137); emit(200); }
            else if (op == '*') { emit(15); emit(175); emit(193); }
            else if (op == '/' || op == '%') {
                emit(137); emit(195); emit(137); emit(200); emit(153); emit(247); emit(251);
                if (op == '%') { emit(137); emit(208); }
            } else if (op == '&') { emit(33); emit(200); }
            else if (op == '|') { emit(9); emit(200); }
            else if (op == '^') { emit(49); emit(200); }
            else if (op == 274 || op == 275) {
                emit(137); emit(202); emit(137); emit(193); emit(137); emit(208); emit(211);
                if (op == 274) emit(224); else emit(248);
            } else {
                emit(57); emit(193); emit(15);
                if (op == 270) emit(148);
                if (op == 271) emit(149);
                if (op == '<') emit(156);
                if (op == '>') emit(159);
                if (op == 272) emit(158);
                if (op == 273) emit(157);
                emit(192); emit(15); emit(182); emit(192);
            }
        }
        expression_kind = 0;
    }
    return 0;
}

int epilogue() {
    emit(139); emit(93); emit(252); emit(201); emit(195);
    return 0;
}

int add_local(int id, int offset, int kind) {
    int i;
    i = 0;
    while (i < local_count) {
        if (vec_get(local_name, i) == id) die((int)"duplicate local");
        i = i + 1;
    }
    vec_set(local_name, local_count, id); vec_set(local_offset, local_count, offset);
    vec_set(local_kind, local_count, kind); local_count = local_count + 1;
    return 0;
}

int statement() {
    int first;
    int second;
    int start;
    int id;
    int kind;
    if (token == '{') {
        lex();
        while (token && token != '}') statement();
        expect('}');
    } else if (token == 260 || token == 261) {
        kind = token - 259; lex();
        if (token != 256) die((int)"expected local name");
        id = intern(vec_data(token_text)); lex();
        local_bytes = local_bytes + 4; add_local(id, -local_bytes - 4, kind);
        if (token != ';') die((int)"locals require one uninitialized scalar per declaration");
        lex();
    } else if (token == 262) {
        lex(); expect('('); expression(1); rvalue(); expect(')');
        emit(133); emit(192); first = branch(132); statement();
        if (token == 263) {
            second = branch(233); resolve_branch(first, code_size); lex(); statement();
            resolve_branch(second, code_size);
        } else resolve_branch(first, code_size);
    } else if (token == 264) {
        lex(); start = code_size; expect('('); expression(1); rvalue(); expect(')');
        emit(133); emit(192); first = branch(132); statement();
        second = branch(233); resolve_branch(second, start); resolve_branch(first, code_size);
    } else if (token == 265) {
        lex(); expression(1); rvalue(); expect(';'); epilogue();
    } else if (token == ';') lex();
    else { expression(1); rvalue(); expect(';'); }
    return 0;
}

int declarations() {
    int type;
    int id;
    int count;
    int parameter;
    int stack_patch;
    while (token) {
        if (token != 260 && token != 261) die((int)"expected global type");
        type = token - 259; lex();
        if (token != 256) die((int)"expected global name");
        id = intern(vec_data(token_text)); lex();
        if (token == '(') {
            if (type != 1) die((int)"functions must return int");
            lex(); local_count = 0; local_bytes = 0; count = 0;
            while (token != ')') {
                expect(260);
                if (token != 256) die((int)"expected parameter name");
                parameter = intern(vec_data(token_text)); lex(); add_local(parameter, 8 + count * 4, 1);
                count = count + 1;
                if (token == ',') lex();
                else if (token != ')') die((int)"expected parameter separator");
            }
            lex(); define_function(id, count);
            emit(85); emit(137); emit(229); emit(83); emit(129); emit(236);
            stack_patch = code_size; word(0);
            if (token != '{') die((int)"expected function body");
            statement(); put32(stack_patch, local_bytes);
            immediate(184, 0); epilogue();
        } else {
            if (vec_get(symbol_kind, id)) die((int)"duplicate global");
            count = 1;
            vec_set(symbol_kind, id, type + 1);
            if (token == '[') {
                lex(); if (token != 257 || token_value < 1) die((int)"expected positive array size");
                count = token_value; lex(); expect(']'); vec_set(symbol_kind, id, type + 3);
            }
            data_size = (data_size + 3) & -4;
            vec_set(symbol_address, id, data_size);
            if (type == 1) {
                if (count > 0x1fffffff) die((int)"array exceeds i386 address range");
                count = count * 4;
            }
            if (count > 0x7fffffff - data_size) die((int)"global size overflow");
            data_size = data_size + count;
            expect(';');
        }
    }
    id = 1;
    while (id <= symbol_count) {
        if (vec_get(symbol_head, id)) die((int)"undefined function");
        id = id + 1;
    }
    return 0;
}

int builtins() {
    int id;
    id = intern((int)"load8"); define_function(id, 1);
    emit(139); emit(68); emit(36); emit(4); emit(15); emit(182); emit(0); emit(195);
    id = intern((int)"load32"); define_function(id, 1);
    emit(139); emit(68); emit(36); emit(4); emit(139); emit(0); emit(195);
    id = intern((int)"store8"); define_function(id, 2);
    emit(139); emit(68); emit(36); emit(4); emit(139); emit(84); emit(36); emit(8);
    emit(136); emit(16); emit(137); emit(208); emit(195);
    id = intern((int)"store32"); define_function(id, 2);
    emit(139); emit(68); emit(36); emit(4); emit(139); emit(84); emit(36); emit(8);
    emit(137); emit(16); emit(137); emit(208); emit(195);
    id = intern((int)"syscall3"); define_function(id, 4);
    emit(83); emit(139); emit(68); emit(36); emit(8);
    emit(139); emit(92); emit(36); emit(12);
    emit(139); emit(76); emit(36); emit(16);
    emit(139); emit(84); emit(36); emit(20);
    emit(205); emit(128); emit(91); emit(195);
    return 0;
}

int elf_header(int file_size) {
    vec_set(machine, 0, 127); vec_set(machine, 1, 'E'); vec_set(machine, 2, 'L'); vec_set(machine, 3, 'F');
    vec_set(machine, 4, 1); vec_set(machine, 5, 1); vec_set(machine, 6, 1);
    put32(16, 0x00030002); put32(20, 1); put32(24, 0x08048080); put32(28, 52);
    put32(40, 0x00200034); put32(44, 2);
    put32(52, 1); put32(56, 0); put32(60, 0x08048000); put32(64, 0x08048000);
    put32(68, file_size); put32(72, file_size); put32(76, 5); put32(80, 4096);
    put32(84, 1); put32(88, file_size); put32(92, data_base); put32(96, data_base);
    put32(100, string_size); put32(104, global_base - data_base + data_size); put32(108, 6); put32(112, 4096);
    return 0;
}

int write_all(int fd, int buffer, int size) {
    int n;
    while (size) {
        n = syscall3(4, fd, buffer, size);
        if (n <= 0) die((int)"output write failed");
        buffer = buffer + n; size = size - n;
    }
    return 0;
}

int main(int argc, int argv) {
    int input;
    int output;
    int n;
    int id;
    line = 1;
    initialize();
    if (argc != 3) die((int)"usage: cc_min source.c output.elf");
    input = syscall3(5, load32(argv + 4), 0, 0);
    if (input < 0) die((int)"cannot open source");
    n = 1;
    while (n) {
        vec_set(source, source_size + 4095, 0);
        n = syscall3(3, input, vec_data(source) + source_size, 4096);
        if (n < 0) die((int)"source read failed");
        source_size = source_size + n;
    }
    syscall3(6, input, 0, 0);
    n = 0;
    while (n < 8) { vec_set(source, source_size + n, 0); n = n + 1; }
    while (code_size < 128) emit(0);
    /* Native entry: argc and argv -> main; its return value -> Linux exit. */
    emit(139); emit(4); emit(36); emit(141); emit(84); emit(36); emit(4);
    emit(82); emit(80); id = intern((int)"main"); call_function(id, 2);
    emit(137); emit(195); immediate(184, 1); emit(205); emit(128); emit(15); emit(11);
    builtins(); lex(); declarations();
    while (code_size & 4095) emit(0);
    data_base = 0x08048000 + code_size;
    global_base = data_base + ((string_size + 3) & -4);
    if (global_base < data_base || data_size > 0x7fffffff - global_base)
        die((int)"output exceeds i386 address range");
    n = 0;
    while (n < load32(reloc_position + 4)) {
        if (vec_get(reloc_kind, n)) id = global_base;
        else id = data_base;
        put32(vec_get(reloc_position, n), id + vec_get(reloc_offset, n));
        n = n + 1;
    }
    elf_header(code_size);
    output = syscall3(5, load32(argv + 8), 577, 493);
    if (output < 0) die((int)"cannot open output");
    write_all(output, vec_data(machine), code_size);
    write_all(output, vec_data(strings), string_size);
    if (syscall3(6, output, 0, 0) < 0) die((int)"output close failed");
    return 0;
}
