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

    function setField(value, name, args) {
        if (name === "Time") return timeClip(args.length ? args[0] : NaN);
        value = Number(value);
        if (value !== value) {
            if (name !== "FullYear") return NaN;
            value = 0;
        }
        var year = yearFromTime(value);
        var month = monthFromTime(value);
        var date = dateFromTime(value);
        var hours = field(value, "Hours");
        var minutes = field(value, "Minutes");
        var seconds = field(value, "Seconds");
        var milliseconds = field(value, "Milliseconds");
        if (name === "Milliseconds") milliseconds = args[0];
        else if (name === "Seconds") {
            seconds = args[0];
            if (args.length > 1) milliseconds = args[1];
        } else if (name === "Minutes") {
            minutes = args[0];
            if (args.length > 1) seconds = args[1];
            if (args.length > 2) milliseconds = args[2];
        } else if (name === "Hours") {
            hours = args[0];
            if (args.length > 1) minutes = args[1];
            if (args.length > 2) seconds = args[2];
            if (args.length > 3) milliseconds = args[3];
        } else if (name === "Date") date = args[0];
        else if (name === "Month") {
            month = args[0];
            if (args.length > 1) date = args[1];
        } else if (name === "FullYear") {
            year = args[0];
            if (args.length > 1) month = args[1];
            if (args.length > 2) date = args[2];
        }
        return timeClip(makeTime(year, month, date, hours, minutes, seconds,
                                 milliseconds));
    }

    function pad(value, width) {
        var result = String(Math.abs(value));
        while (result.length < width) result = "0" + result;
        return result;
    }

    function toString(value) {
        value = Number(value);
        if (value !== value) return "Invalid Date";
        var year = yearFromTime(value);
        return pad(year, 4) + "-" + pad(monthFromTime(value) + 1, 2) +
            "-" + pad(dateFromTime(value), 2) + "T" +
            pad(field(value, "Hours"), 2) + ":" +
            pad(field(value, "Minutes"), 2) + ":" +
            pad(field(value, "Seconds"), 2) + "." +
            pad(field(value, "Milliseconds"), 3) + "Z";
    }

    function decimalDigit(code) {
        return code >= 48 && code <= 57 ? code - 48 : -1;
    }

    function decimalAt(source, start, count) {
        var value = 0;
        var index = 0;
        while (index < count) {
            var digit = decimalDigit(source.charCodeAt(start + index));
            if (digit < 0) return -1;
            value = value * 10 + digit;
            index++;
        }
        return value;
    }

    /* ES5.1 only requires implementations to accept their own Date string
     * formats plus the standardized date-time form. The guest's canonical
     * local zone is UTC, so absent offsets are deterministic as well. */
    function parse(source) {
        source = String(source);
        var length = source.length;
        if (length < 4) return NaN;
        var year = decimalAt(source, 0, 4);
        if (year < 0) return NaN;
        if (length === 4) return timeClip(makeTime(year, 0, 1, 0, 0, 0, 0));
        if (source.charAt(4) !== "-" || length < 7) return NaN;
        var month = decimalAt(source, 5, 2);
        if (month < 1 || month > 12) return NaN;
        if (length === 7) {
            return timeClip(makeTime(year, month - 1, 1, 0, 0, 0, 0));
        }
        if (source.charAt(7) !== "-" || length < 10) return NaN;
        var date = decimalAt(source, 8, 2);
        if (date < 1 || date > 31) return NaN;
        if (length === 10) {
            return timeClip(makeTime(year, month - 1, date, 0, 0, 0, 0));
        }
        if (source.charAt(10) !== "T" || length < 16 ||
            source.charAt(13) !== ":") return NaN;
        var hours = decimalAt(source, 11, 2);
        var minutes = decimalAt(source, 14, 2);
        if (hours > 24 || minutes > 59) return NaN;
        var position = 16;
        var seconds = 0;
        var milliseconds = 0;
        if (source.charAt(position) === ":") {
            seconds = decimalAt(source, position + 1, 2);
            if (seconds > 59) return NaN;
            position += 3;
            if (source.charAt(position) === ".") {
                if (position + 4 > length) return NaN;
                milliseconds = decimalAt(source, position + 1, 3);
                position += 4;
            }
        }
        var offsetMinutes = 0;
        if (source.charAt(position) === "Z") position++;
        else if (source.charAt(position) === "+" ||
                 source.charAt(position) === "-") {
            var sign = source.charAt(position++) === "+" ? 1 : -1;
            var offsetHours = decimalAt(source, position, 2);
            if (source.charAt(position + 2) !== ":") return NaN;
            var offsetPartMinutes = decimalAt(source, position + 3, 2);
            if (offsetHours > 23 || offsetPartMinutes > 59) return NaN;
            offsetMinutes = sign * (offsetHours * 60 + offsetPartMinutes);
            position += 5;
        }
        if (position !== length || (hours === 24 &&
            (minutes || seconds || milliseconds))) return NaN;
        return timeClip(makeTime(year, month - 1, date, hours, minutes,
            seconds, milliseconds) - offsetMinutes * MS_MINUTE);
    }

    var DateSupport = {
        construct: construct,
        field: field,
        makeTime: makeTime,
        timeClip: timeClip,
        dayFromYear: dayFromYear,
        leapYear: leapYear,
        parse: parse,
        setField: setField,
        toString: toString,
        localTimezoneOffset: function () { return 0; }
    };
    root.GuestVMDateSupport = DateSupport;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = DateSupport;
    }
}(this));
