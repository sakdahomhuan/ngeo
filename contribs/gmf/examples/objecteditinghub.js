goog.provide('gmfapp.objecteditinghub');

goog.require('goog.asserts');
/** @suppress {extraRequire} */
goog.require('ngeo.proj.EPSG21781');
goog.require('gmf.ObjectEditingManager');
goog.require('gmf.Themes');
goog.require('gmf.XSDAttributes');
goog.require('ol.format.WFS');


/** @type {!angular.Module} **/
gmfapp.module = angular.module('gmfapp', ['gmf']);


gmfapp.module.value('gmfTreeUrl',
    'https://geomapfish-demo.camptocamp.net/2.1/wsgi/themes?version=2&background=background');


gmfapp.module.value('gmfLayersUrl',
    'https://geomapfish-demo.camptocamp.net/2.1/wsgi/layers/');


/**
 * @param {angular.$http} $http Angular $http service.
 * @param {angular.$q} $q Angular $q service.
 * @param {!angular.Scope} $scope Angular scope.
 * @param {gmf.Themes} gmfThemes The gmf themes service.
 * @param {gmf.XSDAttributes} gmfXSDAttributes The gmf XSDAttributes service.
 * @constructor
 * @ngInject
 */
gmfapp.MainController = function($http, $q, $scope, gmfThemes, gmfXSDAttributes) {

  /**
   * @type {angular.$http}
   * @private
   */
  this.http_ = $http;

  /**
   * @type {angular.$q}
   * @private
   */
  this.q_ = $q;

  /**
   * @type {gmf.Themes}
   * @private
   */
  this.gmfThemes_ = gmfThemes;

  /**
   * @type {gmf.XSDAttributes}
   * @private
   */
  this.gmfXSDAttributes_ = gmfXSDAttributes;

  /**
   * @type {Array.<string>} List of example and application urls that contain
   *     ObjectEditing tools.
   * @export
   */
  this.urls = [
    '../apps/oeedit/',
    'objectediting.html'
  ];

  /**
   * @type {string} OE viewer application base url.
   * @private
   */
  this.viewerUrl_ = '../apps/oeview/';

  /**
   * @type {string}
   * @export
   */
  this.selectedUrl = this.urls[0];

  /**
   * @type {gmfThemes.GmfOgcServers} ogcServers OGC servers.
   * @private
   */
  this.gmfServers_;

  /**
   * @type {gmfThemes.GmfOgcServer} ogcServer OGC server to use.
   * @private
   */
  this.gmfServer_;

  /**
   * @type {Array.<gmfThemes.GmfLayerWMS>}
   * @export
   */
  this.gmfLayerNodes = [];

  /**
   * @type {?gmfThemes.GmfLayerWMS}
   * @export
   */
  this.selectedGmfLayerNode = null;

  /**
   * @type {Object.<number, Array.<ol.Feature>>}
   * @export
   */
  this.featuresCache_ = {};

  /**
   * @type {Array.<ol.Feature>}
   * @export
   */
  this.features = null;

  /**
   * @type {?ol.Feature}
   * @export
   */
  this.selectedFeature = null;

  /**
   * @type {Object.<number, string>}
   * @private
   */
  this.geomTypeCache_ = {};

  /**
   * @type {?string}
   * @export
   */
  this.selectedGeomType = null;

  $scope.$watch(
    function() {
      return this.selectedGmfLayerNode;
    }.bind(this),
    function(newVal, oldVal) {
      this.selectedFeature = null;

      if (newVal) {
        this.getFeatures_(newVal).then(
          this.handleGetFeatures_.bind(this, newVal)
        );
        this.getGeometryType_(newVal).then(
          this.handleGetGeometryType_.bind(this, newVal)
        );
      }
    }.bind(this)
  );

  /**
   * @type {string}
   * @export
   */
  this.themeName = 'ObjectEditing';


  this.gmfThemes_.loadThemes();

  this.gmfThemes_.getOgcServersObject().then(function(ogcServers) {

    // (1) Set OGC servers
    this.gmfServers_ = ogcServers;

    this.gmfThemes_.getThemesObject().then(function(themes) {
      if (!themes) {
        return;
      }

      var i, ii;

      // (2) Find OE theme
      var theme;
      for (i = 0, ii = themes.length; i < ii; i++) {
        if (themes[i].name === this.themeName) {
          theme = themes[i];
          break;
        }
      }

      if (!theme) {
        return;
      }

      // (3) Get first group node
      var groupNode = theme.children[0];

      // (4) Set OGC server, which must support WFS for this example to work
      var gmfServer = this.gmfServers_[groupNode.ogcServer];
      if (gmfServer && gmfServer.wfsSupport === true && gmfServer.urlWfs) {
        this.gmfServer_ = gmfServer;
      } else {
        return;
      }

      var gmfLayerNodes = [];
      for (i = 0, ii = groupNode.children.length; i < ii; i++) {
        if (groupNode.children[i].metadata.identifierAttributeField) {
          gmfLayerNodes.push(groupNode.children[i]);
        }
      }

      // (5) Set layer nodes
      this.gmfLayerNodes = gmfLayerNodes;

      // (6) Select 'polygon' for the purpose of simplifying the demo
      this.selectedGmfLayerNode = this.gmfLayerNodes[1];

    }.bind(this));
  }.bind(this));

};


/**
 * @export
 */
gmfapp.MainController.prototype.runEditor = function() {

  var geomType = this.selectedGeomType;
  var feature = this.selectedFeature;
  var layer = this.selectedGmfLayerNode.id;
  var property = this.selectedGmfLayerNode.metadata.identifierAttributeField;
  goog.asserts.assert(property !== undefined);
  var id = feature.get(property);

  var params = {};
  params[gmf.ObjectEditingManager.Param.GEOM_TYPE] = geomType;
  params[gmf.ObjectEditingManager.Param.ID] = id;
  params[gmf.ObjectEditingManager.Param.LAYER] = layer;
  params[gmf.ObjectEditingManager.Param.THEME] = this.themeName;
  params[gmf.ObjectEditingManager.Param.PROPERTY] = property;

  var url = gmfapp.MainController.appendParams(this.selectedUrl, params);
  window.open(url);
};


/**
 * @export
 */
gmfapp.MainController.prototype.runViewer = function() {

  var node = this.selectedGmfLayerNode;
  var nodeId = node.id;
  var nodeName = node.name;
  var nodeIdAttrFieldName = node.metadata.identifierAttributeField;
  var ids = [];

  var features = this.featuresCache_[nodeId];
  for (var i = 0, ii = features.length; i < ii; i++) {
    ids.push(
      features[i].get(nodeIdAttrFieldName)
    );
  }

  var params = {};
  params['wfs_layer'] = nodeName;
  params['wfs_' + nodeIdAttrFieldName] = ids.join(',');

  var url = gmfapp.MainController.appendParams(this.viewerUrl_, params);
  window.open(url);
};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @return {angular.$q.Promise} The promise attached to the deferred object.
 * @private
 */
gmfapp.MainController.prototype.getFeatures_ = function(gmfLayerNode) {

  this.getFeaturesDeferred_ = this.q_.defer();

  var features = this.getFeaturesFromCache_(gmfLayerNode);

  if (features) {
    this.getFeaturesDeferred_.resolve();
  } else {
    this.issueGetFeatures_(gmfLayerNode);
  }

  return this.getFeaturesDeferred_.promise;
};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @private
 */
gmfapp.MainController.prototype.issueGetFeatures_ = function(gmfLayerNode) {

  var id = gmfLayerNode.id;

  var url = gmfapp.MainController.appendParams(
    this.gmfServer_.urlWfs,
    {
      'SERVICE': 'WFS',
      'REQUEST': 'GetFeature',
      'VERSION': '1.1.0',
      'TYPENAME': gmfLayerNode.layers
    }
  );

  this.http_.get(url).then(function(response) {
    var features = new ol.format.WFS().readFeatures(response.data);
    this.featuresCache_[id] = features;
    this.getFeaturesDeferred_.resolve();
  }.bind(this));
};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @private
 */
gmfapp.MainController.prototype.handleGetFeatures_ = function(gmfLayerNode) {
  var features = /** @type Array.<ol.Feature> */ (
    this.getFeaturesFromCache_(gmfLayerNode));
  this.features = features;
  this.selectedFeature = this.features[0];
};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @return {?Array.<ol.Feature>} List of features
 * @private
 */
gmfapp.MainController.prototype.getFeaturesFromCache_ = function(gmfLayerNode) {
  var id = gmfLayerNode.id;
  var features = this.featuresCache_[id] || null;
  return features;
};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @return {angular.$q.Promise} The promise attached to the deferred object.
 * @private
 */
gmfapp.MainController.prototype.getGeometryType_ = function(gmfLayerNode) {

  this.getGeometryTypeDeferred_ = this.q_.defer();

  var geomType = this.getGeometryTypeFromCache_(gmfLayerNode);

  if (geomType) {
    this.getGeometryTypeDeferred_.resolve();
  } else {
    this.issueGetAttributesRequest_(gmfLayerNode);
  }

  return this.getGeometryTypeDeferred_.promise;
};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @private
 */
gmfapp.MainController.prototype.issueGetAttributesRequest_ = function(
  gmfLayerNode
) {

  this.gmfXSDAttributes_.getAttributes(gmfLayerNode.id).then(
    function(gmfLayerNode, attributes) {
      // Get geom type from attributes and set
      var geomAttr = ngeo.format.XSDAttribute.getGeometryAttribute(attributes);
      if (geomAttr && geomAttr.geomType) {
        this.geomTypeCache_[gmfLayerNode.id] = geomAttr.geomType;
        this.getGeometryTypeDeferred_.resolve();
      }
    }.bind(this, gmfLayerNode)
  );

};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @private
 */
gmfapp.MainController.prototype.handleGetGeometryType_ = function(gmfLayerNode) {
  var geomType = /** @type {string} */ (
    this.getGeometryTypeFromCache_(gmfLayerNode));
  this.selectedGeomType = geomType;
};


/**
 * @param {gmfThemes.GmfLayerWMS} gmfLayerNode Layer node.
 * @return {?string} The type of geometry.
 * @private
 */
gmfapp.MainController.prototype.getGeometryTypeFromCache_ = function(
  gmfLayerNode
) {
  var id = gmfLayerNode.id;
  var geomType = this.geomTypeCache_[id] || null;
  return geomType;
};


/**
 * Appends query parameters to a URI.
 *
 * @param {string} uri The original URI, which may already have query data.
 * @param {!Object} params An object where keys are URI-encoded parameter keys,
 *     and the values are arbitrary types or arrays.
 * @return {string} The new URI.
 */
gmfapp.MainController.appendParams = function(uri, params) {
  var keyParams = [];
  // Skip any null or undefined parameter values
  Object.keys(params).forEach(function(k) {
    if (params[k] !== null && params[k] !== undefined) {
      keyParams.push(k + '=' + encodeURIComponent(params[k]));
    }
  });
  var qs = keyParams.join('&');
  // remove any trailing ? or &
  uri = uri.replace(/[?&]$/, '');
  // append ? or & depending on whether uri has existing parameters
  uri = uri.indexOf('?') === -1 ? uri + '?' : uri + '&';
  return uri + qs;
};


gmfapp.module.controller('MainController', gmfapp.MainController);
