define(["jquery", "moment"], function ($, moment) {

	var log = $('#debug').empty();

	var exports = function (string) {
		log.append('[' + moment().format("HH:mm:ss.SSS") + '] ' + string + '\n');
	};

	return exports;
});