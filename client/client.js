Meteor.subscribe("userData");


Template.userSettings.events({
    'click .save': function (event, template) {
        var stationFrom = template.find('#station-from').value;
        var stationTo = template.find('#station-to').value;
        var timeFrom = template.find('#time-from').value;
        var timeUntil = template.find('#time-until').value;
        var pushNotification = template.find('#push-notification').checked;

        var data = {
            stationFrom: stationFrom,
            stationTo: stationTo,
            timeFrom: timeFrom,
            timeUntil: timeUntil,
            pushNotification: pushNotification
        };

        Meteor.call("updateUserProfile", data);
        return false;
    }
});

Template.schedule.departures = function () {
    return Session.get('departures');
};
Template.schedule.loading = function () {
    return Session.equals("departures", null);
};

Template.schedule.created = function () {
    Session.set("departures", null);
    Meteor.call('getTravelOptions', function (err, result) {
        Session.set('departures', result)
    });
};