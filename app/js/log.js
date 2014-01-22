define(["jquery"], function ($) {

	var log = $('#debug').empty();

	var exports = function (string) {
		log.append(string + '\n');
	};

	return exports;
});