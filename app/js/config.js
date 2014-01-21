require.config({
  baseUrl: 'js',
  paths: {
    "requireLib": "../../bower_components/requirejs/require",
    "components": "../../bower_components",
    "jquery": "../../bower_components/jquery/jquery",
    "text": "../../bower_components/text/text",
    "async": "../../bower_components/requirejs-plugins/src/async",
    "font": "../../bower_components/requirejs-plugins/src/font",
    "goog": "../../bower_components/requirejs-plugins/src/goog",
    "image": "../../bower_components/requirejs-plugins/src/image",
    "json": "../../bower_components/requirejs-plugins/src/json",
    "mdown": "../../bower_components/requirejs-plugins/src/mdown",
    "noext": "../../bower_components/requirejs-plugins/src/noext",
    "propertyParser": "../../bower_components/requirejs-plugins/src/propertyParser"
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