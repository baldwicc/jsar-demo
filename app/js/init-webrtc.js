define([
	"jquery",
	"log",
	"components/getUserMedia.js/dist/getUserMedia"
], function (
	$,
	log
	// getUserMedia
) {

	var defaults = {
		// options contains the configuration information for the shim
		// it allows us to specify the width and height of the video
		// output we're working with, the location of the fallback swf,
		// events that are triggered onCapture and onSave (for the fallback)
		// and so on.
		options: {

			"audio": false, //OTHERWISE FF nightlxy throws an NOT IMPLEMENTED error
			"video": true,

			// the element (by id) you wish to use for displaying the stream from a camera
			el: "webcam",

			// use if you don't require a fallback
			noFallback: false,

			extern: null,
			append: true,

			// height and width of the output stream container
			width: 640,
			height: 480,

			// the recommended mode to be used is 'callback' where a callback is executed once data is available
			mode: "callback",

			// the flash fallback Url
			swffile: "fallback/jscam_canvas_only.swf",

			// quality of the fallback stream
			quality: 85,

			context: "",

			// a debugger callback is available if needed
			debug: function () {},

			// callback for capturing the fallback stream
			onCapture: function () {
				window.webcam.save();
			},

			onTick: function () {},

			// callback for saving the stream, useful for relaying data further.
			onSave: function (data) {},
			onLoad: function () {}
		},

		success: function (stream) {
			log("defaults.options.context: " + defaults.options.context);
			if (defaults.options.context === 'webrtc') {

				var video = defaults.options.videoEl;
				var vendorURL = window.URL || window.webkitURL;
				video.src = vendorURL ? vendorURL.createObjectURL(stream) : stream;

				video.onerror = function () {
					stream.stop();
					streamError();
				};

			} else {
				//flash context
			}
		},
		error: function (error) {
			alert('No camera available.');
			log('An error occurred: [CODE ' + error.code + ']');
		}
	};

	var exports = function (opts) {
		$.extend(opts, defaults);
		getUserMedia(opts.options, opts.success, opts.error);
	};

	return exports;

});