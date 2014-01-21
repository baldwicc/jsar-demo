'use strict';

module.exports = function (grunt) {

  // Project configuration.
  grunt.initConfig({
    // Metadata.
    pkg: grunt.file.readJSON('package.json'),
    banner: '/*! <%= pkg.name %> - v<%= pkg.version %> - ' +
      '<%= grunt.template.today("yyyy-mm-dd") %>\n' +
      '<%= pkg.homepage ? "* " + pkg.homepage + "\\n" : "" %>' +
      '* Copyright (c) <%= grunt.template.today("yyyy") %> <%= pkg.author.name %>;' +
      ' Licensed <%= _.pluck(pkg.licenses, "type").join(", ") %> */\n',

    // Task configuration.
    qunit: {
      files: ['test/**/*.html']
    },
    clean: ['dist'],
    jshint: {
      gruntfile: {
        options: {
          jshintrc: '.jshintrc'
        },
        src: 'Gruntfile.js'
      },
      app: {
        options: {
          jshintrc: 'app/js/.jshintrc'
        },
        src: ['app/js/**/*.js']
      },
      test: {
        options: {
          jshintrc: 'test/.jshintrc'
        },
        src: ['test/**/*.js']
      },
    },
    watch: {
      gruntfile: {
        files: '<%= jshint.gruntfile.src %>',
        tasks: ['jshint:gruntfile']
      },
      app: {
        files: '<%= jshint.app.src %>',
        tasks: ['jshint:app', 'qunit']
      },
      test: {
        files: '<%= jshint.test.src %>',
        tasks: ['jshint:test', 'qunit']
      },
    },
    requirejs: {
      compile: {
        options: {
          mainConfigFile: 'app/js/config.js',
          appDir: 'app/',
          dir: 'dist/',
          baseUrl: 'js',
          optimize: 'none',
          modules: [{
            name: "main",
            include: ["requireLib"]
          }]
        }
      }
    },
    replace: {
      requirejs: {
        src: ['dist/**/*.js', 'dist/**/*.htm', 'dist/**/*.html'],
        overwrite: true,
        replacements: [{
          from: /\.\.\/bower_components\/requirejs\/require\.js/,
          to: "js/require.js"
        }]
      }
    },
    rename: {
      requirejs: {
        src: 'dist/js/main.js',
        dest: 'dist/js/require.js'
      }
    },
    connect: {
      development: {
        options: {
          keepalive: true,
          port: 8000,
        }
      },
      production: {
        options: {
          keepalive: true,
          port: 8888,
          base: 'dist'
        }
      }
    }
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-contrib-requirejs');
  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.loadNpmTasks('grunt-text-replace');
  grunt.loadNpmTasks('grunt-rename');

  // Default task.
  grunt.registerTask('default', [
    //    'jshint',
    'clean',
    'qunit',
    'requirejs',
    'replace:requirejs',
    'rename:requirejs'
  ]);

  grunt.registerTask('preview', [
    'connect:development'
  ]);

  grunt.registerTask('preview-live', [
    'default',
    'connect:production'
  ]);

};