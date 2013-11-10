if (Meteor.isClient) {
    Template.schedule.departures = function () {
        return Session.get('departures');
    };
    Template.schedule.loading = function () {
        return Session.equals("departures", null);
    }

    Template.schedule.created = function () {
        Session.set("departures", null);
        Meteor.call('getSchedule', function (err, result) {
            Session.set('departures', result)
        });
    }
}

if (Meteor.isServer) {

    Meteor.startup(function () {
        Meteor.setInterval(function(){
            var now = moment();
            var from = moment().set('hour', '08').set('minute', '50');
            var until = moment().set('hour', '09').set('minute', '10');
            if (now.isAfter(from) && now.isBefore(until)) {
                Meteor.call('getSchedule')
            }
        }, 60000)
    });

    Meteor.methods({
        getSchedule: function () {
            console.log("getSchedule")
            var xml2js = Meteor.require("xml2js");
            var moment = Meteor.require("moment");
            var url = "http://webservices.ns.nl/ns-api-avt?station=Delft";

            var options = {'auth': Meteor.settings.ns_auth_string};
            var response = HTTP.get(url, options);
            console.log('Response status: ', response.status);

            var parser = xml2js.Parser();
            var objects;
            parser.parseString(response.content, function (err, result) {
                departures = result.ActueleVertrekTijden.VertrekkendeTrein
                console.log('Parsing done')
            });

            var selection = [];
            for (var key in departures) {
                var departure = departures[key];
                var date_str = departure.VertrekTijd[0].replace(/\+[0-9]+/g, '');
                var date_time = moment(date_str);
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

            if (selection && selection.length > 0) {
                Meteor.call('sendPushNotification', selection);
            }

            return selection;
        },

        sendPushNotification: function (departures) {

            var moment = Meteor.require('moment');
            var now = moment();
            var from = moment().set('hour', '08').set('minute', '50');
            var until = moment().set('hour', '09').set('minute', '10');
            if (now.isBefore(from) && now.isAfter(until)) {
                // return when not in timeframe
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
                'secret': Meteor.settings.boxcar_secret
            };
            var url = "http://boxcar.io/devices/providers/" + Meteor.settings.boxcar_key + "/notifications/broadcast";
            HTTP.post(url, {params: data});

            //console.log('Response status: ', response.status);
            //console.log('Response content: ', response.content);


            //var boxcar = Meteor.require('node-boxcar');
            //var provider = new boxcar.provider(Meteor.settings.boxcar_key, Meteor.settings.boxcar_secret);


            //provider.notify({'email': Meteor.settings.boxcar_email,
            //    'message': 'Helleu',
            //    'from_screen_name': 'Sandros'
            //}, function (err, info) {
            //    if (err) {
            //        console.log("err", err);
            //    }
            //    console.log(info);
            //});

            //provider.subscribe({
            //    'email': Meteor.settings.boxcar_email
            //}, function (err, info) {
            //    if (err) {
            //        console.log("err", err);
            //        //throw err;
            //    }
            //    console.log(info);
            //});

            //console.log("provider", provider);

            return "";
        }
    })
}
