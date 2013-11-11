// set default timezone
process.env.TZ = 'Europe/Amsterdam';

TIME_FROM = '08:55';
TIME_UNTIL = '09:10';

POLL_INTERVAL = 60000;

NS_DATE_TIME_FORMAT = 'YYYY-MM-DDTHH:mm:ssZ';

Meteor.startup(function () {
    Meteor.setInterval(function () {
        if(withinTimeFrame(TIME_FROM, TIME_UNTIL)) {
            console.log("with in timeframe, call api");
            Meteor.call('getSchedule')
        }
    }, POLL_INTERVAL)
});

Meteor.methods({
    getSchedule: function () {
        console.log("getSchedule");
        var xml2js = Meteor.require("xml2js");
        var moment = Meteor.require("moment");
        var url = "http://webservices.ns.nl/ns-api-avt?station=Delft";

        var options = {'auth': Meteor.settings.ns_auth_string};
        var response = HTTP.get(url, options);
        console.log('Response status: ', response.statusCode);

        var parser = xml2js.Parser();
        parser.parseString(response.content, function (err, result) {
            departures = result.ActueleVertrekTijden.VertrekkendeTrein;
            console.log('Parsing done')
        });

        var selection = [];
        for (var key in departures) {
            var departure = departures[key];
            // strip timezone, wrong format
            var date_str = departure.VertrekTijd[0];
            // parse date string to moment
            var date_time = moment(date_str, NS_DATE_TIME_FORMAT);
            //console.log('departure', date_time)
            var route_or_dest = departure.RouteTekst ? departure.RouteTekst[0] : departure.EindBestemming[0] + ' (eindbestemming)';
            var on_route = route_or_dest.indexOf('Rotterdam') != -1;
            var delay = departure.VertrekVertragingTekst ? departure.VertrekVertragingTekst[0] : '';
            if (on_route && delay) {
                var time = date_time.format('HH:mm');
                selection.push({'time': time,
                    'delay': delay,
                    'route': route_or_dest
                });
            }
        }
        console.log('selection', selection);

        if (selection.length > 0) {
            Meteor.call('sendPushNotification', selection);
        }

        return selection;
    },

    sendPushNotification: function (departures) {
        if(!withinTimeFrame(TIME_FROM, TIME_UNTIL)) {
            console.log("not in timeframe");
            return false;
        }

        var msg = '';
        for (var i = 0; i < departures.length; i++) {
            var dep = departures[i];
            msg += dep.time + ': ' + dep.delay + ', ';
        }
        console.log('deps', msg);
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
