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