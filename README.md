# jsar demo

First attempt at hacking away with JSARToolkit, Canvas and WebRTC.  
Lifted straight from www.html5rocks.com/en/tutorials/webgl/jsartoolkit_webrtc

## Getting Started

Make sure you have the latest packages installed

```
npm install
bower install
```

Note: If you don't have `npm` installed, make sure you have
[node](http://nodejs.com) installed. If you don't have bower,
`npm install -g bower`.

The above steps will download all the required software to
build and run this app, such as [grunt](http://gruntjs.com),
[requirejs](http://requirejs.org), and [jquery](http://jquery.com).

## Running the server

You can run your app using `grunt preview`. This will start a
server on `localhost:8000`, meaning you can simply go to the
url [localhost:8000/index.htm](http://localhost:8000/index.htm)
while it's running.

If you'd like to run the compiled version, run
`grunt preview-live`.

## Building the application

This application uses requirejs to load the various modules in
the app folder.  It also uses the r.js optimizer to concatenate,
minfiy and move all content from `app/` to `dist/`, ready for static
deployment.

Running `grunt` by itself will run through all of the steps of
linting the javascript, building out dependencies and ultimately
creating content under `/dist/*`.

## Working with JSARToolkit

![AR Marker](https://github.com/baldwicc/jsar-demo/raw/master/app/media/marker.png "AR Marker")

### Tests

Note: you need [phantomJS](http://phantomjs.org) to run the tests.
The test directory uses `qunit`, which is run using phantomJS
in the console, but can also be ran by launching the server
`grunt preview` and going to `localhost:8000/test/index.html`.

Create tests in the `test/tests.js` file, where you can
require your modules and test their functionality.

## Deploying your application on a server

Assuming you're already ran `npm install` and `bower install`,
the only pieces required to run the application in its built
state is running `grunt`.

If you're using a webserver like apache or nginx, you'll want
to create a redirect from `/components/requirejs/require.js` to
`/dist/require.js`. (*Note: this is exactly what `grunt
preview-live` does*)
