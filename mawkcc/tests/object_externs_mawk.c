var external_value;

function mawk_entry() {
    external_value = c_add(external_value, 2);
    return external_value;
}
