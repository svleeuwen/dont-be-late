// set default timezone
process.env.TZ = 'Europe/Amsterdam';

TIME_FROM = '08:55';
TIME_UNTIL = '09:10';

CHECK_TIME_FRAME_INTERVAL = 60000;

NS_STATION_FROM = "Delft";
NS_STATION_TO = "Rotterdam";
NS_DATE_TIME_FORMAT = 'YYYY-MM-DDTHH:mm:ssZ';

INCLUDE_HIGHSPEED = true;
NUM_PREVIOUS_ADVICES = false;


Meteor.publish("userData", function () {
    return Meteor.users.find({_id: this.userId});
});


Meteor.startup(function () {
    Accounts.loginServiceConfiguration.remove({
        service: "facebook"
    });
    Accounts.loginServiceConfiguration.insert({
        service: "facebook",
        appId: Meteor.settings.facebook_app_id,
        secret: Meteor.settings.facebook_secret
    });
    var moment = Meteor.require("moment");
    Meteor.setInterval(function () {
        users = Meteor.users.find({});
        users.forEach(function (user) {
            var profile = user.profile;

            // TODO check timestrings format
            //if (!(profile.timeFrom || profile.timeUntil)) {
            //    return false;
            //}

            if (utils.withinTimeFrame(moment(), profile.timeFrom, profile.timeUntil)) {
                console.log("Within timeframe, call API");
                Meteor.call('getTravelOptions', user);
            }
        })
    }, CHECK_TIME_FRAME_INTERVAL);
});


Meteor.methods({
    getTravelOptions: function (user) {
        console.log("getTravelInfo");
        var xml2js = Meteor.require("xml2js");
        var moment = Meteor.require("moment");
        if (!user) {
            user = Meteor.user();
        }
        var profile = user.profile;

        var url = "http://webservices.ns.nl/ns-api-treinplanner?fromStation=" + profile.stationFrom +
            "&toStation=" + profile.stationTo + "&hslAllowed=" + INCLUDE_HIGHSPEED + "previousAdvices=" + NUM_PREVIOUS_ADVICES;

        var options = {'auth': Meteor.settings.ns_auth_string};
        var response = HTTP.get(url, options);
        console.log('Response status: ', response.statusCode);

        var travelOptions;
        var parser = xml2js.Parser({explicitArray: false});
        parser.parseString(response.content, function (err, result) {
            travelOptions = result.ReisMogelijkheden.ReisMogelijkheid;
            console.log('Parsing done')
        });

        var selection = [];
        var notificationSelection = [];
        for (var key in travelOptions) {
            if (!travelOptions.hasOwnProperty(key)) continue;
            var travelOption = travelOptions[key];
            var departurePlanned = moment(travelOption.GeplandeVertrekTijd, NS_DATE_TIME_FORMAT);
            var departureActual = moment(travelOption.ActueleVertrekTijd, NS_DATE_TIME_FORMAT);
            var delay = departureActual.diff(departurePlanned, 'minutes');

            if (!delay)
                continue;

            var trainType = travelOption.ReisDeel.VervoerType;
            var trackNode = travelOption.ReisDeel.ReisStop[0].Spoor;
            var trackChange = trackNode['$']['wijziging'];
            var result = {};
            // is there delay OR a change of track?
            if (delay || trackChange == true) {

                result['departure_planned'] = departurePlanned.format('HH:mm');
                result['departure_actual'] = departureActual.format('HH:mm');
                result['extra'] = trainType;

                if (trackChange == true) {
                    result['track'] = trackNode['_'];
                }
                if (delay) {
                    result['delay'] = '+ ' + delay;
                }
                // if it's in our timeframe, send a pushnotification
                if (utils.withinTimeFrame(departureActual, profile.timeFrom, profile.timeUntil)) {
                    notificationSelection.push(result);
                }
                selection.push(result);
            }
        }
        console.log('Selection', selection);

        Meteor.call('sendPushNotification', notificationSelection, user);

        return selection;
    },

    sendPushNotification: function (departures, user) {
        console.log("sendPushNotification");
        if (departures.length == 0 || user.profile.pushNotification) {
            return false;
        }
        if (!utils.withinTimeFrame(moment(), user.profile.timeFrom, user.profile.timeUntil)) {
            console.log("Not in timeframe, don't send push notification");
            return false;
        }

        var msg = '';
        for (var i = 0; i < departures.length; i++) {
            var dep = departures[i];
            msg += dep.departure_planned + ':';
            if (dep.delay) {
                msg += ' ' + dep.delay;
                msg += ' (' + dep.departure_actual + ')';
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
            'email': user.services.facebook.email,
            'notification[message]': msg,
            'notification[from_screen_name]': "You could be late",
            "notification[from_remote_service_id]": msg,
            'secret': Meteor.settings.boxcar_secret
        };
        var url = "http://boxcar.io/devices/providers/" + Meteor.settings.boxcar_key + "/notifications/broadcast";
        HTTP.post(url, {params: data});

        return true;
    },

    updateUserProfile: function (profile) {
        console.log('updateUserProfile', profile);
        Meteor.users.update({_id: Meteor.user()._id}, {$set: {'profile.stationFrom': profile.stationFrom,
            'profile.stationTo': profile.stationTo,
            'profile.timeFrom': profile.timeFrom,
            'profile.timeUntil': profile.timeUntil,
            'profile.pushNotification': profile.pushNotification
        }})
    }
});


/* UTILS */

utils = {
    withinTimeFrame: function (time, from, until) {
        var moment = Meteor.require('moment');
        var from_parts = from.split(':');
        var until_parts = until.split(':');
        if (from_parts.length != 2 || until_parts.length != 2) return '';
        var from_time = moment().set('hour', from_parts[0]).set('minute', from_parts[1]);
        var until_time = moment().set('hour', until_parts[0]).set('minute', until_parts[1]);
        // return false if now is before from or after until
        return !(time.isBefore(from_time) || time.isAfter(until_time));
    },

    getMomentByTimeString: function (str) {
        var parts = str.split(':');
        if (parts.length != 2) return '';
        return moment().set('hour', parts[0]).set('minute', parts[1]);
    }

};