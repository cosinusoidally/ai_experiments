if (arguments[0] === "--environment") {
    print(String(process.env.DISPLAY) + "|" +
          String(process.env.XAUTHORITY) + "|" +
          String(process.env.HOME));
} else {
    print("Alternate standalone workload");
}
