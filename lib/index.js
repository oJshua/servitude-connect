var fs = require('fs');
var jsp = require("uglify-js").parser;
var pro = require("uglify-js").uglify;

var cache = {};

function uglify(javascript) {
  var ast = jsp.parse(javascript);
  ast = pro.ast_mangle(ast);
  ast = pro.ast_squeeze(ast);

  return pro.gen_code(ast);
}

var stub = fs.readFileSync(__dirname + '/stub.js', "binary");

function processServitude(files, request, response, options) {

  var css = [],
      js = [],
      errors = [];

  var modified;

  var count = files.length,
      current = 0,
      cached = 0,
      maxage = 0;

  options.files = options.files || {};

  function callback() {
    current++;

    if (current === count) {
      if (cached === count) {
        response.statusCode = 304;
        response.end();
      } else {
        js = js.sort(function(a, b) {
          return a.index - b.index;
        });
        css = css.sort(function(a, b) {
          return a.index - b.index;
        });

        var output = "var servitude = " + JSON.stringify({
          css: css,
          js: js,
          errors: errors
        });

        response.setHeader('Content-Type', 'text/javascript');
        response.setHeader('Date', new Date().toUTCString());

        response.setHeader('Last-Modified', maxage);
        response.setHeader('Age', parseInt((new Date().valueOf() - maxage) / 1000, 10));

        response.write(output + "\n" + stub);
        response.end();
      }
    }
  }

  function addEntry(filename, data, index, cached) {
    if (filename.match(".+js$")) {
      if (cached !== true) {
        if (options.filter && typeof(options.filter) === 'function') {
          data = options.filter(data, "javascript");
        }

        if (options.uglify === true) {
          data = uglify(data);
        }
      }

      js.push({
        filename: filename,
        contents: data,
        index: index
      });
    } else if (filename.match(".+css$")) {
      if (cached !== true) {
        if (options.filter && typeof(options.filter) === 'function') {
          data = options.filter(data, "css");
        }

        css.push({
          filename: filename,
          contents: data,
          index: index
        });
      }
    } else {
      errors.push("Unknown file type for " + filename);
    }

    if (options.cache === true && cached !== true) {
      cache[filename] = data;
    }
  }

  if (request.headers['if-modified-since']) {
    modified = Date.parse(request.headers['if-modified-since']);
  }


  files.forEach(function(elem, index) {
    var filename = options.basedir + "/" + elem;

    if (elem in options.files) {
      addEntry(elem, options.files[elem], index, true);
      cached++;
      return callback();
    }

    fs.stat(filename, function(err, stats) {
      if (err) {
        errors.push("Unable to read " + elem);
        callback();
      } else {
        if (options.cache && modified !== undefined && modified <= stats.mtime.valueOf() && cache[elem] !== undefined) {

          cached++;
          if (maxage < stats.mtime.valueOf()) {
            maxage = stats.mtime.valueOf();
          }

          addEntry(elem, cache[elem], index, true);

          callback();
        } else {
          fs.readFile(filename, "binary", function(err, data) {
            if (err) {
              errors.push("Unable to load " + elem);
            } else {
              addEntry(elem, data, index, false);
            }

            callback();
          });
        }
      }
    });
  });
};

module.exports = function servitude(route, options) {
  return function(request, response, next) {

    options = options || {};

    var parts = request.url.match(route);

    if (!parts) {
      return next();
    }

    var files = parts[1].split(',');

    processServitude(files, request, response, options);
  };
};