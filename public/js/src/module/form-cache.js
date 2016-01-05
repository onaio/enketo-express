/**
 * Deals with browser storage
 */

'use strict';

var store = require( './store' );
var connection = require( './connection' );
var $ = require( 'jquery' );

var hash;

function init( survey ) {
    return store.init()
        .then( function() {
            return get( survey );
        } )
        .then( function( result ) {
            if ( result ) {
                return result;
            } else {
                return set( survey );
            }
        } )
        .then( _transformRequest )
        .then( _setUpdateIntervals )
        .then( _setResetListener );
}

function get( survey ) {
    return store.survey.get( survey.enketoId );
}

function set( survey ) {
    return connection.getFormParts( survey )
        .then( _swapMediaSrc )
        .then( store.survey.set );
}

function remove( survey ) {
    return store.survey.remove( survey.enketoId );
}

function _transformRequest( survey ) {
    return connection.getFormPartsHash( survey, true );
}

function _setUpdateIntervals( survey ) {
    hash = survey.hash;

    // Check for form update upon loading.
    // Note that for large Xforms where the XSL transformation takes more than 30 seconds, 
    // the first update make take 20 minutes to propagate to the browser of the very first user(s) 
    // that open the form right after the XForm update.
    setTimeout( function() {
        _updateCache( survey );
    }, 1 * 1000 );
    // check for form update every 20 minutes
    setInterval( function() {
        _updateCache( survey );
    }, 20 * 60 * 1000 );

    return Promise.resolve( survey );
}

/**
 * Form resets require reloading the form media.
 * This makes form resets slower, but it makes initial form loads faster.
 *
 * @param {[type]} survey [description]
 */
function _setResetListener( survey ) {

    $( document ).on( 'formreset', function( event ) {
        if ( event.target.nodeName.toLowerCase() === 'form' ) {
            survey.$form = $( this );
            updateMedia( survey );
        }
    } );

    return Promise.resolve( survey );
}

function _swapMediaSrc( survey ) {
    survey.form = survey.form.replace( /(src=\"[^"]*\")/g, 'data-offline-$1 src=""' );

    return Promise.resolve( survey );
}

/**
 * Updates maximum submission size if this hasn't been defined yet.
 * The first time this function is called is when the user is online.
 * If the form/data server updates their max size setting, this value
 * will be updated the next time the cache is refreshed.
 *
 * @param  {[type]} survey [description]
 * @return {[type]}        [description]
 */
function updateMaxSubmissionSize( survey ) {

    if ( !survey.maxSize ) {
        return connection.getMaximumSubmissionSize()
            .then( function( maxSize ) {
                survey.maxSize = maxSize;
                return survey;
            } );
    } else {
        return Promise.resolve( survey );
    }
}

/**
 * Loads survey resources either from the store or via HTTP (and stores them)
 *
 * @param  {[type]} survey [description]
 * @return {Promise}        [description]
 */
function updateMedia( survey ) {
    var requests = [];

    // if survey.resources exists, the resources are available in the store
    if ( survey.resources ) {
        return _loadMedia( survey );
    }

    survey.resources = [];

    _getElementsGroupedBySrc( survey.$form.add( $( '.form-header' ) ) ).forEach( function( elements ) {
        var src = elements[ 0 ].dataset.offlineSrc;
        requests.push( connection.getMediaFile( src ) );
    } );

    return Promise.all( requests.map( _reflect ) )
        .then( function( resources ) {
            // filter out the failed requests (undefined)
            resources = resources.filter( function( resource ) {
                return !!resource;
            } );
            survey.resources = resources;
            return survey;
        } )
        // store any resources that were succesfull
        .then( store.survey.update )
        .then( _loadMedia )
        .catch( function( error ) {
            console.error( 'loadMedia failed', error );
            // Let the flow continue. 
            return survey;
        } );
}

/**
 * To be used with Promise.all if you want the results to be returned even if some 
 * have failed. Failed tasks will return undefined.
 *
 * @param  {Promise} task [description]
 * @return {*}         [description]
 */
function _reflect( task ) {
    return task
        .then( function( response ) {
                return response;
            },
            function( error ) {
                console.error( error );
                return;
            } );
}

function _loadMedia( survey ) {
    var resourceUrl;
    var URL = window.URL || window.webkitURL;

    _getElementsGroupedBySrc( survey.$form.add( $( '.form-header' ) ) ).forEach( function( elements ) {
        var src = elements[ 0 ].dataset.offlineSrc;
        // TODO: For nicer loading and hiding ugly alt attribute text, 
        // maybe add style: visibility: hidden until the src is populated?
        store.survey.resource.get( survey.enketoId, src )
            .then( function( resource ) {
                if ( !resource || !resource.item ) {
                    console.error( 'resource not found or not complete', resource );
                    return;
                }
                // create a resourceURL
                resourceUrl = URL.createObjectURL( resource.item );
                // add this resourceURL as the src for all elements in the group
                elements.forEach( function( element ) {
                    element.src = resourceUrl;
                } );
            } );
    } );

    // TODO: revoke objectURL if not inside a repeat
    // add eventhandler to last element in a group?
    // $( element ).one( 'load', function() {
    //    console.log( 'revoking object URL to free up memory' );
    //    URL.revokeObjectURL( resourceUrl );
    // } );

    return Promise.resolve( survey );
}

function _getElementsGroupedBySrc( $form ) {
    var groupedElements = [];
    var urls = {};
    var $els = $form.find( '[data-offline-src]' );

    $els.each( function() {
        if ( !urls[ this.dataset.offlineSrc ] ) {
            var src = this.dataset.offlineSrc;
            var $group = $els.filter( function() {
                if ( this.dataset.offlineSrc === src ) {
                    // remove from $els to improve performance
                    $els = $els.not( '[data-offline-src="' + src + '"]' );
                    return true;
                }
            } );

            urls[ src ] = true;
            groupedElements.push( $.makeArray( $group ) );
        }
    } );

    return groupedElements;
}

function _updateCache( survey ) {

    console.debug( 'checking for survey update' );

    connection.getFormPartsHash( survey )
        .then( function( version ) {
            if ( hash === version ) {
                console.debug( 'Cached survey is up to date!', hash );
            } else {
                console.debug( 'Cached survey is outdated! old:', hash, 'new:', version );
                return connection.getFormParts( survey )
                    .then( function( formParts ) {
                        // media will be updated next time the form is loaded if resources is undefined
                        formParts.resources = undefined;
                        return formParts;
                    } )
                    .then( _swapMediaSrc )
                    .then( store.survey.update )
                    .then( function( result ) {
                        // set the hash so that subsequent update checks won't redownload the form
                        hash = result.hash;
                        console.debug( 'Survey is now updated in the store. Need to refresh.' );
                        $( document ).trigger( 'formupdated' );
                    } );
            }
        } )
        .catch( function( error ) {
            // if the form has been de-activated or removed from the server
            if ( error.status === 404 ) {
                // remove it from the store
                remove( survey )
                    .then( function() {
                        // TODO notify user to refresh or trigger event on form
                        console.log( 'survey ' + survey.enketoId + ' removed from storage' );
                    } )
                    .catch( function( e ) {
                        console.error( 'an error occurred when attempting to remove the survey from storage', e );
                    } );
            } else {
                console.log( 'Could not obtain latest survey or hash from server or failed to save it. Probably offline.', error.stack );
            }
        } );
}

/**
 * Completely flush the form cache (not the data storage)
 *
 * @return {Promise} [description]
 */
function flush() {
    return store.survey.removeAll()
        .then( function() {
            console.log( 'Done! The form cache is empty now. (Records have not been removed)' );
            return;
        } );
}

module.exports = {
    init: init,
    get: get,
    updateMaxSubmissionSize: updateMaxSubmissionSize,
    updateMedia: updateMedia,
    remove: remove,
    flush: flush
};
