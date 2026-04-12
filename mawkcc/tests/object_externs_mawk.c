var external_value;

function mawk_entry() {
    external_value = c_sub(add(external_value, 4), 2);
    return external_value;
}
