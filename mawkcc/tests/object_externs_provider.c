extern int mawk_entry(void);

int external_value = 40;

int c_sub(int a, int b)
{
    return a - b;
}

int main(void)
{
    return mawk_entry();
}
