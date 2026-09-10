/* Deterministic ES5.1 Date arithmetic. The guest currently defines its local
 * time zone as UTC; calendar conversion never delegates to the host VM's Date. */
(function (root) {
    var MS_SECOND = 1000;
    var MS_MINUTE = 60000;
    var MS_HOUR = 3600000;
    var MS_DAY = 86400000;

    function integer(value) {
        value = Number(value);
        if (value !== value || value === 0 ||
            value === Infinity || value === -Infinity) return value;
        return value < 0 ? -Math.floor(-value) : Math.floor(value);
    }

    function modulo(value, divisor) {
        var result = value % divisor;
        return result < 0 ? result + divisor : result;
    }

    function leapYear(year) {
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }

    function dayFromYear(year) {
        return 365 * (year - 1970) + Math.floor((year - 1969) / 4) -
            Math.floor((year - 1901) / 100) +
            Math.floor((year - 1901) / 400);
    }

    function daysBeforeMonth(year, month) {
        var starts = leapYear(year) ?
            [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335] :
            [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        return starts[month];
    }

    function makeTime(year, month, date, hours, minutes, seconds, milliseconds) {
        year = integer(year);
        month = integer(month);
        date = integer(date);
        hours = integer(hours);
        minutes = integer(minutes);
        seconds = integer(seconds);
        milliseconds = integer(milliseconds);
        if (year !== year || month !== month || date !== date || hours !== hours ||
            minutes !== minutes || seconds !== seconds ||
            milliseconds !== milliseconds) return NaN;
        year += Math.floor(month / 12);
        month = modulo(month, 12);
        return (dayFromYear(year) + daysBeforeMonth(year, month) + date - 1) *
            MS_DAY + hours * MS_HOUR + minutes * MS_MINUTE +
            seconds * MS_SECOND + milliseconds;
    }

    function timeClip(value) {
        value = Number(value);
        if (value !== value || value === Infinity || value === -Infinity ||
            Math.abs(value) > 8640000000000000) return NaN;
        return integer(value) + 0;
    }

    function construct(argumentsList, now) {
        if (!argumentsList.length) return timeClip(now);
        if (argumentsList.length === 1) return timeClip(argumentsList[0]);
        var year = Number(argumentsList[0]);
        if (year === year && year >= 0 && year <= 99) year += 1900;
        return timeClip(makeTime(
            year, argumentsList[1],
            argumentsList.length > 2 ? argumentsList[2] : 1,
            argumentsList.length > 3 ? argumentsList[3] : 0,
            argumentsList.length > 4 ? argumentsList[4] : 0,
            argumentsList.length > 5 ? argumentsList[5] : 0,
            argumentsList.length > 6 ? argumentsList[6] : 0));
    }

    function yearFromTime(value) {
        if (value !== value) return NaN;
        var year = 1970 + Math.floor(value / (365.2425 * MS_DAY));
        while (value < dayFromYear(year) * MS_DAY) year--;
        while (value >= dayFromYear(year + 1) * MS_DAY) year++;
        return year;
    }

    function monthFromTime(value) {
        var year = yearFromTime(value);
        if (year !== year) return NaN;
        var day = Math.floor(value / MS_DAY) - dayFromYear(year);
        var month = 11;
        while (month > 0 && day < daysBeforeMonth(year, month)) month--;
        return month;
    }

    function dateFromTime(value) {
        var year = yearFromTime(value);
        if (year !== year) return NaN;
        var month = monthFromTime(value);
        return Math.floor(value / MS_DAY) - dayFromYear(year) -
            daysBeforeMonth(year, month) + 1;
    }

    function field(value, name) {
        value = Number(value);
        if (value !== value) return NaN;
        if (name === "FullYear") return yearFromTime(value);
        if (name === "Month") return monthFromTime(value);
        if (name === "Date") return dateFromTime(value);
        if (name === "Day") return modulo(Math.floor(value / MS_DAY) + 4, 7);
        if (name === "Hours") return modulo(Math.floor(value / MS_HOUR), 24);
        if (name === "Minutes") return modulo(Math.floor(value / MS_MINUTE), 60);
        if (name === "Seconds") return modulo(Math.floor(value / MS_SECOND), 60);
        if (name === "Milliseconds") return modulo(Math.floor(value), 1000);
        throw new Error("unknown guest Date field " + name);
    }

    var DateSupport = {
        construct: construct,
        field: field,
        makeTime: makeTime,
        timeClip: timeClip,
        dayFromYear: dayFromYear,
        leapYear: leapYear,
        localTimezoneOffset: function () { return 0; }
    };
    root.GuestVMDateSupport = DateSupport;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = DateSupport;
    }
}(this));
