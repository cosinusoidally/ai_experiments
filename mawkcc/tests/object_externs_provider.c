extern int mawk_entry(void);

int external_value = 40;

int c_add(int a, int b)
{
    return a + b;
}

int main(void)
{
    return mawk_entry();
}
