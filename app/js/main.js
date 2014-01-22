/* jshint undef: true */
require([
  "jquery",
  "log",
  "getusermedia"
], function (
  $,
  log,
  getUserMediaInit
) {

  var init = function () {

    getUserMediaInit({});

  };
  $(document).ready(function () {
    log('init!');
    init();
  });

});