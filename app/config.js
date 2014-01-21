require.config({
  // make components more sensible
  // expose jquery 
  paths: {
    "components": "../bower_components",
    "jquery": "../bower_components/jquery/jquery"
  },
  shim: {
    "components/JSARToolKit/JSARToolKit": {
      deps: ["components/magi/src/magi"]
    }
  }
});

if (!window.requireTestMode) {
  require(['main'], function () {});
}