// set default timezone
process.env.TZ = 'Europe/Amsterdam';

TIME_FROM = '08:55';
TIME_UNTIL = '09:10';

CHECK_TIME_FRAME_INTERVAL = 60000;

NS_STATION_FROM = "Delft";
NS_STATION_TO = "Rotterdam";
NS_DATE_TIME_FORMAT = 'YYYY-MM-DDTHH:mm:ssZ';

Meteor.startup(function () {
    Meteor.setInterval(function () {
        if (withinTimeFrame(TIME_FROM, TIME_UNTIL)) {
            console.log("Within timeframe, call API");
            Meteor.call('getSchedule')
        }
    }, CHECK_TIME_FRAME_INTERVAL);
});

Meteor.methods({
    getSchedule: function () {
        console.log("getSchedule");
        var xml2js = Meteor.require("xml2js");
        var moment = Meteor.require("moment");
        var url = "http://webservices.ns.nl/ns-api-avt?station=" + NS_STATION_FROM;

        var options = {'auth': Meteor.settings.ns_auth_string};
        var response = HTTP.get(url, options);
        console.log('Response status: ', response.statusCode);

        var parser = xml2js.Parser({explicitArray: false});
        parser.parseString(response.content, function (err, result) {
            departures = result.ActueleVertrekTijden.VertrekkendeTrein;
            console.log('Parsing done')
        });

        var selection = [];
        for (var key in departures) {
            var departure = departures[key];
            // strip timezone, wrong format
            var date_str = departure.VertrekTijd;
            // parse date string to moment
            var date_time = moment(date_str, NS_DATE_TIME_FORMAT);
            var route_or_dest = departure.RouteTekst ? departure.RouteTekst : departure.EindBestemming + ' (eindbestemming)';
            var on_route = route_or_dest.indexOf(NS_STATION_TO) != -1;
            var delay = departure.VertrekVertragingTekst ? departure.VertrekVertragingTekst : '';
            var track_change = departure.VertrekSpoor['$']['wijziging'];
            var result = {};
            if (on_route && (delay || track_change == true)) {
                result['time'] = date_time.format('HH:mm');
                result['route'] = route_or_dest;

                if (track_change == true) {
                    result['track'] = departure.VertrekSpoor['_'];
                }
                if (delay) {
                    result['delay'] = delay;
                }
                selection.push(result);
            }
        }
        console.log('Selection', selection);

        if (selection.length > 0) {
            Meteor.call('sendPushNotification', selection);
        }

        return selection;
    },

    sendPushNotification: function (departures) {
        if (!withinTimeFrame(TIME_FROM, TIME_UNTIL)) {
            console.log("Not in timeframe, don't send push notification");
            return false;
        }

        var msg = '';
        for (var i = 0; i < departures.length; i++) {
            var dep = departures[i];
            msg += dep.time + ':';
            if (dep.delay) {
                msg += ' ' + dep.delay;
            }
            if (dep.track) {
                msg += ' sp. ' + track;
            }
            if (i != departures.length - 1) {
                msg += ', '
            } else {
                msg += '.'
            }
        }
        console.log('Notification:', msg);

        var data = {
            'email': Meteor.settings.boxcar_email,
            'notification[message]': msg,
            'notification[from_screen_name]': "You could be late",
            "notification[from_remote_service_id]": msg,
            'secret': Meteor.settings.boxcar_secret
        };
        var url = "http://boxcar.io/devices/providers/" + Meteor.settings.boxcar_key + "/notifications/broadcast";
        HTTP.post(url, {params: data});

        return true;
    }
});


/* UTILS */

function withinTimeFrame(from, until) {
    var moment = Meteor.require('moment');
    var now = moment();
    var from_parts = from.split(':');
    var until_parts = until.split(':');
    var from_time = moment().set('hour', from_parts[0]).set('minute', from_parts[1]);
    var until_time = moment().set('hour', until_parts[0]).set('minute', until_parts[1]);
    // return false if now is before from or after until
    return !(now.isBefore(from_time) || now.isAfter(until_time));
}
