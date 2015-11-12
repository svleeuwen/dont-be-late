// set default timezone
process.env.TZ = 'Europe/Amsterdam';

CHECK_TIME_FRAME_INTERVAL = 60000;

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
        secret: Meteor.settings.facebook_app_secret
    });
    var moment = Meteor.npmRequire("moment");
    Meteor.setInterval(function () {
        users = Meteor.users.find({});
        users.forEach(function (user) {
            var profile = user.profile;

            // TODO check timestrings format
            //if (!(profile.timeFrom || profile.timeUntil)) {
            //    return false;
            //}

            if (utils.withinTimeFrame(moment(), profile.timeCheckFrom, profile.timeUntil)) {
                console.log("Within timeframe, call API");
                Meteor.call('getTravelOptions', user);
            }
        })
    }, CHECK_TIME_FRAME_INTERVAL);
});


Meteor.methods({
    getTravelOptions: function (user) {
        console.log("getTravelInfo");
        var xml2js = Meteor.npmRequire("xml2js");
        var moment = Meteor.npmRequire("moment");
        if (!user) {
            user = Meteor.user();
        }
        var profile = user.profile;

        var url = "http://webservices.ns.nl/ns-api-treinplanner?fromStation=" + profile.stationFrom +
            "&toStation=" + profile.stationTo + "&hslAllowed=" + INCLUDE_HIGHSPEED + "previousAdvices=" + NUM_PREVIOUS_ADVICES;

        var options = {'auth': Meteor.settings.ns_auth_string};
        var response = HTTP.get(url, options);
        console.log('Response status: ', response.statusCode);

        var travelOptions = {};
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
                result['station_from'] = profile.stationFrom;
                result['station_to'] = profile.stationTo;

                if (trackChange == true) {
                    result['track'] = trackNode['_'];
                }
                if (delay) {
                    result['delay'] = '+' + delay;
                }
                // if it's in our time frame, add for push notification
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
        var moment = Meteor.npmRequire('moment');
        if (departures.length == 0 || !user.profile.pushNotification) {
            return false;
        }
        if (!utils.withinTimeFrame(moment(), user.profile.timeCheckFrom, user.profile.timeUntil)) {
            console.log("Not in timeframe, don't send push notification");
            return false;
        }
        if (!user.profile.boxCarToken) {
            console.log("No boxcar access token provided");
            return false;
        }

        var msg = '';
        for (var i = 0; i < departures.length; i++) {
            var dep = departures[i];
            // add slice of station strings
            msg += dep.station_from.slice(0, 3) + '-' + dep.station_to.slice(0, 3) + ': ';
            msg += dep.departure_planned + ':';
            if (dep.delay) {
                msg += ' ' + dep.delay;
                msg += ' (' + dep.extra.slice(0, 3) + ')';
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

        var oldMsg = user.profile.latestPushNotification;
        if (msg == oldMsg) {
            // do not the same message more than once
            console.log('Message has not changed:', msg);
            return false;
        }

        // see: http://help.boxcar.io/support/solutions/articles/6000004813-how-to-send-a-notification-to-boxcar-for-ios-users
        var data = {
            'user_credentials': user.profile.boxCarToken,
            'notification[title]': msg,
            'notification[long_message]': msg
        };

        // save for later
        Meteor.users.update({_id: user._id}, {
            $set: {
                'profile.latestPushNotification': msg
            }
        });

        var url = "https://new.boxcar.io/api/notifications";
        HTTP.post(url, {params: data});

        console.log('Send notification:', data);

        return true;
    },

    updateUserProfile: function (profile) {
        console.log('updateUserProfile', profile);
        Meteor.users.update({_id: Meteor.user()._id}, {
            $set: {
                'profile.stationFrom': profile.stationFrom,
                'profile.stationTo': profile.stationTo,
                'profile.timeFrom': profile.timeFrom,
                'profile.timeUntil': profile.timeUntil,
                'profile.timeCheckFrom': profile.timeCheckFrom,
                'profile.pushNotification': profile.pushNotification,
                'profile.boxCarToken': profile.boxCarToken
            }
        })
    }
});


/* UTILS */

utils = {
    withinTimeFrame: function (time, from, until) {
        var moment = Meteor.npmRequire('moment');
        var from_parts = from.split(':');
        var until_parts = until.split(':');
        if (from_parts.length != 2 || until_parts.length != 2) return '';
        var from_time = moment().set('hour', from_parts[0]).set('minute', from_parts[1]);
        var until_time = moment().set('hour', until_parts[0]).set('minute', until_parts[1]);
        // return false if now is before from or after until
        return !(time.isBefore(from_time) || time.isAfter(until_time));
    },

    getMomentByTimeString: function (str) {
        var moment = Meteor.npmRequire('moment');
        var parts = str.split(':');
        if (parts.length != 2) return '';
        return moment().set('hour', parts[0]).set('minute', parts[1]);
    }

};