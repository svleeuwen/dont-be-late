if (Meteor.isClient) {
    Template.schedule.departures = function () {
        return Session.get('departures');
    };
    Template.schedule.loading = function(){
        return Session.equals("departures",null);
    }

    Template.schedule.created = function () {
        Session.set("departures",null);
        Meteor.call('getSchedule', function (err, result) {
            Session.set('departures', result)
        });
    }
}

if (Meteor.isServer) {
    Meteor.startup(function () {


    });

    Meteor.methods({
        getSchedule: function () {
            console.log("getSchedule")
            var xml2js = Meteor.require("xml2js");
            var moment = Meteor.require("moment");
            // code to run on server at startup
            //var XmlStream = Meteor.require("xml-stream");
            var url = "http://webservices.ns.nl/ns-api-avt?station=Delft";

            var options = {'auth': Meteor.settings.ns_auth_string};
            var response = HTTP.get(url, options);
            //console.log(result.content);
            //response.setEncoding('utf-8');

            var parser = xml2js.Parser();
            var objects;
            parser.parseString(response.content, function (err, result) {
                //console.dir(result);
                console.log('Done');
                departures = result.ActueleVertrekTijden.VertrekkendeTrein
            });

            var interest = [];
            for (var key in departures) {
                var departure = departures[key];
                var date_str = departure.VertrekTijd[0].replace(/\+[0-9]+/g, '');
                var date_time = moment(date_str);
                var route_or_dest = departure.RouteTekst ? departure.RouteTekst[0] : departure.EindBestemming[0] + ' (eindbestemming)';
                var on_route = route_or_dest.indexOf('Rotterdam') != -1;
                var delay = departure.VertrekVertragingTekst ? departure.VertrekVertragingTekst[0] : '';
                if (delay) {
                    var time = date_time.format('HH:mm');
                    interest.push({'time': time,
                        'delay': delay,
                        'route': route_or_dest
                    });
                }
            }
            console.log('interest', interest);

            return interest;
        }
    })
}
