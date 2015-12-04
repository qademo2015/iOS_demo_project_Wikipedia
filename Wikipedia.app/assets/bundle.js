(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (module) {

function Bridge() {
}

var eventHandlers = {};

Bridge.prototype.handleMessage = function( type, payload ) {
    var that = this;
    if ( eventHandlers.hasOwnProperty( type ) ) {
        eventHandlers[type].forEach( function( callback ) {
                                    callback.call( that, payload );
                                    } );
    }
};

Bridge.prototype.registerListener = function( messageType, callback ) {
    if ( eventHandlers.hasOwnProperty( messageType ) ) {
        eventHandlers[messageType].push( callback );
    } else {
        eventHandlers[messageType] = [ callback ];
    }
};

Bridge.prototype.sendMessage = function( messageType, payload ) {
    setTimeout(function() { // See: https://phabricator.wikimedia.org/T96822 and http://stackoverflow.com/a/9782220/135557
        var messagePack = { type: messageType, payload: payload };
        var url = "x-wikipedia-bridge:" + encodeURIComponent( JSON.stringify( messagePack ) );

        // quick iframe version based on http://stackoverflow.com/a/6508343/82439
        // fixme can this be an XHR instead? check Cordova current state
        var iframe = document.createElement('iframe');
        iframe.setAttribute("src", url);
        document.documentElement.appendChild(iframe);
        iframe.parentNode.removeChild(iframe);
        iframe = null;
    }, 0);
};

module.exports = new Bridge();

})(module);

},{}],2:[function(require,module,exports){
//  Created by Monte Hurd on 12/28/13.
//  Used by methods in "UIWebView+ElementLocation.h" category.
//  Copyright (c) 2013 Wikimedia Foundation. Provided under MIT-style license; please copy and modify!

function stringEndsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

function getZoomLevel() {
    // From: http://stackoverflow.com/a/5078596/135557
    var deviceWidth = (Math.abs(window.orientation) === 90) ? screen.height : screen.width;
    var zoom = deviceWidth / window.innerWidth;
    return zoom;
}

exports.getImageWithSrc = function(src) {
    var images = document.getElementsByTagName('img');
    for (var i = 0; i < images.length; ++i) {
        if (stringEndsWith(images[i].src, src)) {
            return images[i];
        }
    }
    return null;
};

exports.getElementRect = function(element) {
    var rect = element.getBoundingClientRect();
    var zoom = getZoomLevel();
    var zoomedRect = {
        top: rect.top * zoom,
        left: rect.left * zoom,
        width: rect.width * zoom,
        height: rect.height * zoom
    };
    return zoomedRect;
};

exports.getElementRectAsJson = function(element) {
    return JSON.stringify(this.getElementRect(element));
};

exports.getIndexOfFirstOnScreenElementWithTopGreaterThanY = function(elementPrefix, elementCount){
    for (var i = 0; i < elementCount; ++i) {
        var div = document.getElementById(elementPrefix + i);
        if (div === null) {
            continue;
        }
        var rect = this.getElementRect(div);
        if ( (rect.top >= 0) || ((rect.top + rect.height) >= 0)) {
            return i;
        }
    }
    return -1;
};

},{}],3:[function(require,module,exports){
(function () {
var bridge = require("./bridge");
var transformer = require("./transformer");
var refs = require("./refs");
var issuesAndDisambig = require("./transforms/collapsePageIssuesAndDisambig");
var utilities = require("./utilities");

// DOMContentLoaded fires before window.onload! That's good!
// See: http://stackoverflow.com/a/3698214/135557
document.addEventListener("DOMContentLoaded", function() {

    transformer.transform( "moveFirstGoodParagraphUp", document );
    transformer.transform( "hideRedlinks", document );
    transformer.transform( "addImageOverflowXContainers", document ); // Needs to happen before "widenImages" transform.
    transformer.transform( "widenImages", document );
    transformer.transform( "hideTables", document );
    transformer.transform( "collapsePageIssuesAndDisambig", document.getElementById( "section_heading_and_content_block_0" ) );

    bridge.sendMessage( "DOMContentLoaded", {} );
});

bridge.registerListener( "setLanguage", function( payload ){
    var html = document.querySelector( "html" );
    html.lang = payload.lang;
    html.dir = payload.dir;
    html.classList.add( 'content-' + payload.dir );
    html.classList.add( 'ui-' + payload.uidir );
    document.querySelector('base').href = 'https://' + payload.lang + '.wikipedia.org/';
} );

bridge.registerListener( "setPageProtected", function() {
    document.getElementsByTagName( "html" )[0].classList.add( "page-protected" );
} );

document.onclick = function() {
    // Reminder: resist adding any click/tap handling here - they can
    // "fight" with items in the touchEndedWithoutDragging handler.
    // Add click/tap handling to touchEndedWithoutDragging instead.
    event.preventDefault(); // <-- Do not remove!
};

// track where initial touches start
var touchDownY = 0.0;
document.addEventListener(
            "touchstart",
            function (event) {
                touchDownY = parseInt(event.changedTouches[0].clientY);
            }, false);

function handleTouchEnded(event){
    var touchobj = event.changedTouches[0];
    var touchEndY = parseInt(touchobj.clientY);
    if (((touchDownY - touchEndY) === 0) && (event.changedTouches.length === 1)) {
        // None of our tap events should fire if the user dragged vertically.
        touchEndedWithoutDragging(event);
    }
}

function touchEndedWithoutDragging(event){
    /*
     there are certain elements which don't have an <a> ancestor, so if we fail to find it,
     specify the event's target instead
     */
    var didSendMessage = maybeSendMessageForTarget(event, utilities.findClosest(event.target, 'A') || event.target);

    var hasSelectedText = window.getSelection().rangeCount > 0;

    if (!didSendMessage && !hasSelectedText) {
        // Do NOT prevent default behavior -- this is needed to for instance
        // handle deselection of text.
        bridge.sendMessage('nonAnchorTouchEndedWithoutDragging', {
                              id: event.target.getAttribute( "id" ),
                              tagName: event.target.tagName
                          });

    }
}

/**
 * Attempts to send a bridge message which corresponds to `hrefTarget`, based on various attributes.
 * @return `true` if a message was sent, otherwise `false`.
 */
function maybeSendMessageForTarget(event, hrefTarget){
    if (!hrefTarget) {
        return false;
    }
    var href = hrefTarget.getAttribute( "href" );
    var hrefClass = hrefTarget.getAttribute('class');
    if (href && refs.isReference(href)) {
        // Handle reference links with a popup view instead of scrolling about!
        refs.sendNearbyReferences( hrefTarget );
    } else if (href && href[0] === "#") {
        var targetId = href.slice(1);
        if ( "issues" === targetId ) {
            var issuesPayload = issuesAndDisambig.issuesClicked( hrefTarget );
            bridge.sendMessage( 'issuesClicked', issuesPayload );
        } else if ( "disambig" === targetId ) {
            var disambigPayload = issuesAndDisambig.disambigClicked( hrefTarget );
            bridge.sendMessage( 'disambigClicked', disambigPayload );
        } else if ( "issues_container_close_button" === targetId ) {
            issuesAndDisambig.closeClicked();
        } else {
            // If it is a link to an anchor in the current page, use existing link handling
            // so top floating native header height can be taken into account by the regular
            // fragment handling logic.
            bridge.sendMessage( 'linkClicked', { 'href': href });
        }
    } else if (typeof hrefClass === 'string' && hrefClass.indexOf('image') !== -1) {
         var url = event.target.getAttribute('src');
        bridge.sendMessage('imageClicked', { 'url': url });
    } else if (href) {
        bridge.sendMessage( 'linkClicked', { 'href': href });
    } else {
        return false;
    }
    return true;
}

document.addEventListener("touchend", handleTouchEnded, false);

})();

},{"./bridge":1,"./refs":5,"./transformer":8,"./transforms/collapsePageIssuesAndDisambig":11,"./utilities":16}],4:[function(require,module,exports){

var bridge = require("./bridge");
var elementLocation = require("./elementLocation");

window.bridge = bridge;
window.elementLocation = elementLocation;

},{"./bridge":1,"./elementLocation":2}],5:[function(require,module,exports){
var bridge = require("./bridge");

function isReference( href ) {
    return ( href.slice( 0, 10 ) === "#cite_note" );
}

function goDown( element ) {
    return element.getElementsByTagName( "A" )[0];
}

/**
 * Skip over whitespace but not other elements
 */
function skipOverWhitespace( skipFunc ) {
    return (function(element) {
        do {
            element = skipFunc( element );
            if (element && element.nodeType == Node.TEXT_NODE) {
                if (element.textContent.match(/^\s+$/)) {
                    // Ignore empty whitespace
                    continue;
                } else {
                    break;
                }
            } else {
                // found an element or ran out
                break;
            }
        } while (true);
        return element;
    });
}

var goLeft = skipOverWhitespace( function( element ) {
    return element.previousSibling;
});

var goRight = skipOverWhitespace( function( element ) {
    return element.nextSibling;
});

function hasReferenceLink( element ) {
    try {
        return isReference( goDown( element ).getAttribute( "href" ) );
    } catch (e) {
        return false;
    }
}

function collectRefText( sourceNode ) {
    var href = sourceNode.getAttribute( "href" );
    var targetId = href.slice(1);
    var targetNode = document.getElementById( targetId );
    if ( targetNode === null ) {
        /*global console */
        console.log("reference target not found: " + targetId);
        return "";
    }

    // preferably without the back link
    var refTexts = targetNode.getElementsByClassName( "reference-text" );
    if ( refTexts.length > 0 ) {
        targetNode = refTexts[0];
    }

    return targetNode.innerHTML;
}

function collectRefLink( sourceNode ) {
    var node = sourceNode;
    while (!node.classList || !node.classList.contains('reference')) {
        node = node.parentNode;
        if (!node) {
            return '';
        }
    }
    return node.id;
}

function sendNearbyReferences( sourceNode ) {
    var refsIndex = 0;
    var refs = [];
    var linkId = [];
    var linkText = [];
    var curNode = sourceNode;

    // handle clicked ref:
    refs.push( collectRefText( curNode ) );
    linkId.push( collectRefLink( curNode ) );
    linkText.push( curNode.textContent );

    // go left:
    curNode = sourceNode.parentElement;
    while ( hasReferenceLink( goLeft( curNode ) ) ) {
        refsIndex += 1;
        curNode = goLeft( curNode );
        refs.unshift( collectRefText( goDown ( curNode ) ) );
        linkId.unshift( collectRefLink( curNode ) );
        linkText.unshift( curNode.textContent );
    }

    // go right:
    curNode = sourceNode.parentElement;
    while ( hasReferenceLink( goRight( curNode ) ) ) {
        curNode = goRight( curNode );
        refs.push( collectRefText( goDown ( curNode ) ) );
        linkId.push( collectRefLink( curNode ) );
        linkText.push( curNode.textContent );
    }

    // Special handling for references
    bridge.sendMessage( 'referenceClicked', {
        "refs": refs,
        "refsIndex": refsIndex,
        "linkId": linkId,
        "linkText": linkText
    } );
}

exports.isReference = isReference;
exports.sendNearbyReferences = sendNearbyReferences;

},{"./bridge":1}],6:[function(require,module,exports){
(function (global){
var sectionHeaders = require("./sectionHeaders");

function scrollDownByTopMostSectionHeaderHeightIfNecessary(fragmentId){
    var header = sectionHeaders.getSectionHeaderForId(fragmentId);
    if  (header.id != fragmentId){
        window.scrollBy(0, -header.getBoundingClientRect().height);
    }
}

function scrollToFragment(fragmentId){
    location.hash = '';
    location.hash = fragmentId;
    /*
    Setting location.hash scrolls the element to very top of screen. If this
    element is not a section header it will be positioned *under* the top
    static section header, so shift it down by the static section header 
    height in these cases.
    */
    scrollDownByTopMostSectionHeaderHeightIfNecessary(fragmentId);
}

global.scrollToFragment = scrollToFragment;
}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./sectionHeaders":7}],7:[function(require,module,exports){
(function (global){
var utilities = require("./utilities");

var querySelectorForHeadingsToNativize = 'h1.section_heading, h2.section_heading, h3.section_heading';

function getSectionHeadersArray(){
    var nodeList = document.querySelectorAll(querySelectorForHeadingsToNativize);
    var nodeArray = Array.prototype.slice.call(nodeList);
    nodeArray = nodeArray.map(function(n){
        return {
            anchor:n.getAttribute('id'),
            sectionId:n.getAttribute('sectionId'),
            text:n.textContent
        };
    });
    return nodeArray;
}

function getSectionHeaderLocationsArray(){
    var nodeList = document.querySelectorAll(querySelectorForHeadingsToNativize);
    var nodeArray = Array.prototype.slice.call(nodeList);
    nodeArray = nodeArray.map(function(n){
        return n.getBoundingClientRect().top;
    });
    return nodeArray;
}

function getSectionHeaderForId(id){
    var sectionHeadingParent = utilities.findClosest(document.getElementById(id), 'div[id^="section_heading_and_content_block_"]');
    var sectionHeading = sectionHeadingParent.querySelector(querySelectorForHeadingsToNativize);
    return sectionHeading;
}

exports.getSectionHeaderForId = getSectionHeaderForId;
global.getSectionHeadersArray = getSectionHeadersArray;
global.getSectionHeaderLocationsArray = getSectionHeaderLocationsArray;

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./utilities":16}],8:[function(require,module,exports){
function Transformer() {
}

var transforms = {};

Transformer.prototype.register = function( transform, fun ) {
    if ( transform in transforms ) {
        transforms[transform].push( fun );
    } else {
        transforms[transform] = [ fun ];
    }
};

Transformer.prototype.transform = function( transform, element ) {
    var functions = transforms[transform];
    for ( var i = 0; i < functions.length; i++ ) {
        functions[i](element);
    }
};

module.exports = new Transformer();

},{}],9:[function(require,module,exports){

require("./transforms/collapseTables");
require("./transforms/relocateFirstParagraph");
require("./transforms/hideRedLinks");
require("./transforms/addImageOverflowContainers");
require("./transforms/collapsePageIssuesAndDisambig");

},{"./transforms/addImageOverflowContainers":10,"./transforms/collapsePageIssuesAndDisambig":11,"./transforms/collapseTables":12,"./transforms/hideRedLinks":13,"./transforms/relocateFirstParagraph":14}],10:[function(require,module,exports){
var transformer = require("../transformer");
var utilities = require("../utilities");

function shouldAddImageOverflowXContainer(image) {
    if ((image.width > (window.screen.width * 0.8)) && !utilities.isNestedInTable(image)){
        return true;
    }else{
        return false;
    }
}

function addImageOverflowXContainer(image, ancestor) {
    image.setAttribute('hasOverflowXContainer', 'true'); // So "widenImages" transform knows instantly not to widen this one.
    var div = document.createElement( 'div' );
    div.className = 'image_overflow_x_container';
    ancestor.parentElement.insertBefore( div, ancestor );
    div.appendChild( ancestor );
}

function maybeAddImageOverflowXContainer() {
    var image = this;
    if (shouldAddImageOverflowXContainer(image)){
        var ancestor = utilities.firstAncestorWithMultipleChildren (image);
        if(ancestor){
            addImageOverflowXContainer(image, ancestor);
        }
    }
}

transformer.register( "addImageOverflowXContainers", function( content ) {
    // Wrap wide images in a <div style="overflow-x:auto">...</div> so they can scroll
    // side to side if needed without causing the entire section to scroll side to side.
    var images = content.getElementsByTagName('img');
    for (var i = 0; i < images.length; ++i) {
        // Load event used so images w/o style or inline width/height
        // attributes can still have their size determined reliably.
        images[i].addEventListener('load', maybeAddImageOverflowXContainer, false);
    }
} );

},{"../transformer":8,"../utilities":16}],11:[function(require,module,exports){
var transformer = require("../transformer");
var utilities = require("../utilities");

transformer.register( 'collapsePageIssuesAndDisambig', function( content ) {
    transformer.transform( "displayDisambigLink", content);
    transformer.transform( "displayIssuesLink", content);

    var issuesContainer = document.getElementById('issues_container');
    if(!issuesContainer){
        return;
    }
    issuesContainer.setAttribute( "dir", window.directionality );

    // If we have both issues and disambiguation, then insert the separator.
    var disambigBtn = document.getElementById( "disambig_button" );
    var issuesBtn = document.getElementById( "issues_button" );
    if (issuesBtn !== null && disambigBtn !== null) {
        var separator = document.createElement( 'span' );
        separator.innerText = '|';
        separator.className = 'issues_separator';
        issuesContainer.insertBefore(separator, issuesBtn.parentNode);
    }

    // Hide the container if there were no page issues or disambiguation.
    issuesContainer.style.display = (disambigBtn || issuesBtn) ? 'inherit' : 'none';
} );

transformer.register( 'displayDisambigLink', function( content ) {
    var hatnotes = content.querySelectorAll( "div.hatnote" );
    if ( hatnotes.length > 0 ) {
        var container = document.getElementById( "issues_container" );
        var wrapper = document.createElement( 'div' );
        var link = document.createElement( 'a' );
        link.setAttribute( 'href', '#disambig' );
        link.className = 'disambig_button';
        link.innerHTML = utilities.httpGetSync('wmf://localize/page-similar-titles');
        link.id = 'disambig_button';
        wrapper.appendChild( link );
        var i = 0,
            len = hatnotes.length;
        for (; i < len; i++) {
            wrapper.appendChild( hatnotes[i] );
        }
        container.appendChild( wrapper );
    }
} );

transformer.register( 'displayIssuesLink', function( content ) {
    var issues = content.querySelectorAll( "table.ambox:not([class*='ambox-multiple_issues']):not([class*='ambox-notice'])" );
    if ( issues.length > 0 ) {
        var el = issues[0];
        var container = document.getElementById( "issues_container" );
        var wrapper = document.createElement( 'div' );
        var link = document.createElement( 'a' );
        link.setAttribute( 'href', '#issues' );
        link.className = 'issues_button';
        link.innerHTML = utilities.httpGetSync('wmf://localize/page-issues');
        link.id = 'issues_button';
        wrapper.appendChild( link );
        el.parentNode.replaceChild( wrapper, el );
        var i = 0,
            len = issues.length;
        for (; i < len; i++) {
            wrapper.appendChild( issues[i] );
        }
        container.appendChild( wrapper );
    }
} );

function collectDisambig( sourceNode ) {
    var res = [];
    var links = sourceNode.querySelectorAll( 'div.hatnote a' );
    var i = 0,
        len = links.length;
    for (; i < len; i++) {
        // Pass the href; we'll decode it into a proper page title in Obj-C
        if(links[i].getAttribute( 'href' ).indexOf("redlink=1") === -1){
            res.push( links[i] );
        }
    }
    return res;
}

function collectIssues( sourceNode ) {
    var res = [];
    var issues = sourceNode.querySelectorAll( 'table.ambox' );
    var i = 0,
        len = issues.length;
    for (; i < len; i++) {
        // .ambox- is used e.g. on eswiki
        res.push( issues[i].querySelector( '.mbox-text, .ambox-text' ).innerHTML );
    }
    return res;
}

function anchorForAnchor(anchor) {
    var url = anchor.getAttribute( 'href' );
    var titleForDisplay = anchor.text.substring(0,1).toUpperCase() + anchor.text.substring(1);
    return '<a class="ios-disambiguation-item-anchor" href="' + url + '" >' + titleForDisplay + '</a>';
}

function divForIssue(issue) {
    return '<div class="ios-issue-item">' + issue + '</div>';
}

function insertAfter(newNode, referenceNode) {
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

function setIsSelected(el, isSelected) {
    if(isSelected){
        el.style.borderBottom = "1px dotted #bbb;";
        el.style.color = '#000';
    }else{
        el.style.borderBottom = "none";
        el.style.color = '#777';
    }
}

function toggleSubContainerButtons( activeSubContainerId, focusButtonId, blurButtonId ){
    var buttonToBlur = document.getElementById( blurButtonId );
    if(buttonToBlur) {
        setIsSelected(buttonToBlur, false);
    }
    var buttonToActivate = document.getElementById( focusButtonId );
    var isActiveSubContainerPresent = document.getElementById( activeSubContainerId ) ? true : false;
    setIsSelected(buttonToActivate, isActiveSubContainerPresent);
}

function toggleSubContainers( activeSubContainerId, inactiveSubContainerId, activeSubContainerContents ){
    var containerToRemove = document.getElementById( inactiveSubContainerId );
    var closeButton = document.getElementById('issues_container_close_button');
    if(containerToRemove){
        containerToRemove.parentNode.removeChild(containerToRemove);
    }
    var containerToAddOrToggle = document.getElementById( activeSubContainerId );
    if(containerToAddOrToggle){
        containerToAddOrToggle.parentNode.removeChild(containerToAddOrToggle);
        closeButton.style.display = 'none';
    }else{
        containerToAddOrToggle = document.createElement( 'div' );
        containerToAddOrToggle.id = activeSubContainerId;
        containerToAddOrToggle.innerHTML = activeSubContainerContents;
        insertAfter(containerToAddOrToggle, document.getElementById('issues_container'));
        closeButton.style.display = 'inherit';
    }
}

function closeClicked() {
    if(document.getElementById( 'disambig_sub_container' )){
        toggleSubContainers('disambig_sub_container', 'issues_sub_container', null);
        toggleSubContainerButtons('disambig_sub_container', 'disambig_button', 'issues_button');
    }else if(document.getElementById( 'issues_sub_container' )){
        toggleSubContainers('issues_sub_container', 'disambig_sub_container', null);
        toggleSubContainerButtons('issues_sub_container', 'issues_button', 'disambig_button');
    }
}

function issuesClicked( sourceNode ) {
    var issues = collectIssues( sourceNode.parentNode );
    var disambig = collectDisambig( sourceNode.parentNode.parentNode ); // not clicked node

    toggleSubContainers('issues_sub_container', 'disambig_sub_container',  issues.map(divForIssue).join( "" ));
    toggleSubContainerButtons('issues_sub_container', 'issues_button', 'disambig_button');

    return { "hatnotes": disambig, "issues": issues };
}

function disambigClicked( sourceNode ) {
    var disambig = collectDisambig( sourceNode.parentNode );
    var issues = collectIssues( sourceNode.parentNode.parentNode ); // not clicked node

    toggleSubContainers('disambig_sub_container', 'issues_sub_container', disambig.map(anchorForAnchor).sort().join( "" ));
    toggleSubContainerButtons('disambig_sub_container', 'disambig_button', 'issues_button');

    return { "hatnotes": disambig, "issues": issues };
}

exports.issuesClicked = issuesClicked;
exports.disambigClicked = disambigClicked;
exports.closeClicked = closeClicked;

},{"../transformer":8,"../utilities":16}],12:[function(require,module,exports){
var transformer = require("../transformer");
var utilities = require("../utilities");

/*
Tries to get an array of table header (TH) contents from a given table.
If there are no TH elements in the table, an empty array is returned.
*/
function getTableHeader( element ) {
    var thArray = [];
    if (element.children === undefined || element.children === null) {
        return thArray;
    }
    for (var i = 0; i < element.children.length; i++) {
        var el = element.children[i];
        if (el.tagName === "TH") {
            // ok, we have a TH element!
            // However, if it contains more than two links, then ignore it, because
            // it will probably appear weird when rendered as plain text.
            var aNodes = el.querySelectorAll( "a" );
            if (aNodes.length < 3) {
                // Also ignore it if it's identical to the page title.
                if (el.innerText.length > 0 && el.innerText !== window.pageTitle && el.innerHTML !== window.pageTitle) {
                    thArray.push(el.innerText);
                }
            }
        }
        //if it's a table within a table, don't worry about it
        if (el.tagName === "TABLE") {
            continue;
        }
        //recurse into children of this element
        var ret = getTableHeader(el);
        //did we get a list of TH from this child?
        if (ret.length > 0) {
            thArray = thArray.concat(ret);
        }
    }
    return thArray;
}

/*
OnClick handler function for expanding/collapsing tables and infoboxes.
*/
function tableCollapseClickHandler() {
    var container = this.parentNode;
    var divCollapsed = container.children[0];
    var tableFull = container.children[1];
    var divBottom = container.children[2];
    if (tableFull.style.display !== 'none') {
        tableFull.style.display = 'none';
        divCollapsed.classList.remove('app_table_collapse_close');
        divCollapsed.classList.remove('app_table_collapse_icon');
        divCollapsed.classList.add('app_table_collapsed_open');
        divBottom.style.display = 'none';
        //if they clicked the bottom div, then scroll back up to the top of the table.
        if (this === divBottom) {
            window.scrollTo( 0, container.offsetTop - 48 );
        }
    } else {
        tableFull.style.display = 'block';
        divCollapsed.classList.remove('app_table_collapsed_open');
        divCollapsed.classList.add('app_table_collapse_close');
        divCollapsed.classList.add('app_table_collapse_icon');
        divBottom.style.display = 'block';
    }
}

function shouldTableBeCollapsed( table ) {
    if (table.style.display === 'none' ||
        table.classList.contains( 'navbox' ) ||
        table.classList.contains( 'vertical-navbox' ) ||
        table.classList.contains( 'navbox-inner' ) ||
        table.classList.contains( 'metadata' ) ||
        table.classList.contains( 'mbox-small' )) {
        return false;
    }
    return true;
}

transformer.register( "hideTables", function( content ) {
                     
    var isMainPage = utilities.httpGetSync('wmf://article/is-main-page');
                     
    if (isMainPage == "1") return;
                     
    var tables = content.querySelectorAll( "table" );
    for (var i = 0; i < tables.length; i++) {
        var table = tables[i];
        if (utilities.findClosest (table, '.app_table_container')) continue;

        if (!shouldTableBeCollapsed(table)) {
            continue;
        }

        var isInfobox = table.classList.contains( 'infobox' );
        
        var parent = table.parentElement;

        // If parent contains only this table it's safe to reset its styling
        if (parent.childElementCount === 1){
            parent.removeAttribute("class");
            parent.removeAttribute("style");
        }

        // Remove max width restriction
        table.style.maxWidth = 'none';

        var headerText = getTableHeader(table);

        var caption = "<strong>" + (isInfobox ? utilities.httpGetSync('wmf://localize/info-box-title') : utilities.httpGetSync('wmf://localize/table-title-other')) + "</strong>";
        caption += "<span class='app_span_collapse_text'>";
        if (headerText.length > 0) {
            caption += ": " + headerText[0];
        }
        if (headerText.length > 1) {
            caption += ", " + headerText[1];
        }
        if (headerText.length > 0) {
            caption += " ...";
        }
        caption += "</span>";

        //create the container div that will contain both the original table
        //and the collapsed version.
        var containerDiv = document.createElement( 'div' );
        containerDiv.className = 'app_table_container';
        table.parentNode.insertBefore(containerDiv, table);
        table.parentNode.removeChild(table);

        //remove top and bottom margin from the table, so that it's flush with
        //our expand/collapse buttons
        table.style.marginTop = "0px";
        table.style.marginBottom = "0px";

        //create the collapsed div
        var collapsedDiv = document.createElement( 'div' );
        collapsedDiv.classList.add('app_table_collapsed_container');
        collapsedDiv.classList.add('app_table_collapsed_open');
        collapsedDiv.innerHTML = caption;

        //create the bottom collapsed div
        var bottomDiv = document.createElement( 'div' );
        bottomDiv.classList.add('app_table_collapsed_bottom');
        bottomDiv.classList.add('app_table_collapse_icon');
        bottomDiv.innerHTML = utilities.httpGetSync('wmf://localize/info-box-close-text');

        //add our stuff to the container
        containerDiv.appendChild(collapsedDiv);
        containerDiv.appendChild(table);
        containerDiv.appendChild(bottomDiv);

        //set initial visibility
        table.style.display = 'none';
        collapsedDiv.style.display = 'block';
        bottomDiv.style.display = 'none';

        //assign click handler to the collapsed divs
        collapsedDiv.onclick = tableCollapseClickHandler;
        bottomDiv.onclick = tableCollapseClickHandler;
    }
} );

},{"../transformer":8,"../utilities":16}],13:[function(require,module,exports){
var transformer = require("../transformer");

transformer.register( "hideRedlinks", function( content ) {
	var redLinks = content.querySelectorAll( 'a.new' );
	for ( var i = 0; i < redLinks.length; i++ ) {
		var redLink = redLinks[i];
        redLink.style.color = 'inherit';
	}
} );

},{"../transformer":8}],14:[function(require,module,exports){
var transformer = require("../transformer");

transformer.register( "moveFirstGoodParagraphUp", function( content ) {
    /*
    Instead of moving the infobox down beneath the first P tag,
    move the first good looking P tag *up* (as the first child of
    the first section div). That way the first P text will appear not
    only above infoboxes, but above other tables/images etc too!
    */

    if(content.getElementById( "mainpage" ))return;

    var block_0 = content.getElementById( "content_block_0" );
    if(!block_0) return;

    var allPs = block_0.getElementsByTagName( "p" );
    if(!allPs) return;

    for ( var i = 0; i < allPs.length; i++ ) {
        var p = allPs[i];

        // Narrow down to first P which is direct child of content_block_0 DIV.
        // (Don't want to yank P from somewhere in the middle of a table!)
        if  (p.parentNode != block_0) continue;

        // Ensure the P being pulled up has at least a couple lines of text.
        // Otherwise silly things like a empty P or P which only contains a
        // BR tag will get pulled up (see articles on "Chemical Reaction" and
        // "Hawaii").
        // Trick for quickly determining element height:
        //      https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement.offsetHeight
        //      http://stackoverflow.com/a/1343350/135557
        var minHeight = 40;
        var pIsTooSmall = (p.offsetHeight < minHeight);
        if(pIsTooSmall) continue;

        // Move the P! Place it just after the lead section edit button.
        block_0.insertBefore(p, block_0.firstChild);

        // But only move one P!
        break;
    }
});

},{"../transformer":8}],15:[function(require,module,exports){
var transformer = require("../transformer");
var utilities = require("../utilities");

var maxStretchRatioAllowedBeforeRequestingHigherResolution = 1.3;

// If enabled, widened images will have thin red dashed border and
// and widened images for which a higher resolution version was
// requested will have thick red dashed border.
var enableDebugBorders = false;

function widenAncestors (el) {
    while ((el = el.parentElement) && !el.classList.contains('content_block')){
        // Only widen if there was a width setting. Keeps changes minimal.
        if(el.style.width){
            el.style.width = '100%';
        }
        if(el.style.maxWidth){
            el.style.maxWidth = '100%';
        }
        if(el.style.float){
            el.style.float = 'none';
        }
    }
}

function shouldWidenImage(image) {
    if (
        image.width >= 64 &&
        image.hasAttribute('srcset') &&
        !image.hasAttribute('hasOverflowXContainer') &&
        !utilities.isNestedInTable(image)
        ) {
        return true;
    }else{
        return false;
    }
}

function makeRoomForImageWidening(image) {
    // Expand containment so css wideImageOverride width percentages can take effect.
    widenAncestors (image);

    // Remove width and height attributes so wideImageOverride width percentages can take effect.
    image.removeAttribute("width");
    image.removeAttribute("height");
}

function getStretchRatio(image){
    var widthControllingDiv = utilities.firstDivAncestor(image);
    if (widthControllingDiv){
        return (widthControllingDiv.offsetWidth / image.naturalWidth);
    }
    return 1.0;
}

function useHigherResolutionImageSrcFromSrcsetIfNecessary(image) {
    if (image.getAttribute('srcset')){
        var stretchRatio = getStretchRatio(image);
        if (stretchRatio > maxStretchRatioAllowedBeforeRequestingHigherResolution) {
            var srcsetDict = utilities.getDictionaryFromSrcset(image.getAttribute('srcset'));
            /*
            Grab the highest res url from srcset - avoids the complexity of parsing urls
            to retrieve variants - which can get tricky - canonicals have different paths 
            than size variants
            */
            var largestSrcsetDictKey = Object.keys(srcsetDict).reduce(function(a, b) {
              return a > b ? a : b;
            });

            image.src = srcsetDict[largestSrcsetDictKey];

            if(enableDebugBorders){
                image.style.borderWidth = '10px';
            }
        }
    }
}

function widenImage(image) {
    makeRoomForImageWidening (image);
    image.classList.add("wideImageOverride");

    if(enableDebugBorders){
        image.style.borderStyle = 'dashed';
        image.style.borderWidth = '1px';
        image.style.borderColor = '#f00';
    }

    useHigherResolutionImageSrcFromSrcsetIfNecessary(image);
}

function maybeWidenImage() {
    var image = this;
    if (shouldWidenImage(image)) {
        widenImage(image);
    }
}

transformer.register( "widenImages", function( content ) {
    var images = content.querySelectorAll( 'img' );
    for ( var i = 0; i < images.length; i++ ) {
        // Load event used so images w/o style or inline width/height
        // attributes can still have their size determined reliably.
        images[i].addEventListener('load', maybeWidenImage, false);
    }
} );

},{"../transformer":8,"../utilities":16}],16:[function(require,module,exports){

function getDictionaryFromSrcset(srcset) {
    /*
    Returns dictionary with density (without "x") as keys and urls as values.
    Parameter 'srcset' string:
        '//image1.jpg 1.5x, //image2.jpg 2x, //image3.jpg 3x'
    Returns dictionary:
        {1.5: '//image1.jpg', 2: '//image2.jpg', 3: '//image3.jpg'}
    */
    var sets = srcset.split(',').map(function(set) {
        return set.trim().split(' ');
    });
    var output = {};
    sets.forEach(function(set) {
        output[set[1].replace('x', '')] = set[0];
    });
    return output;
}

function firstDivAncestor (el) {
    while ((el = el.parentElement)){
        if(el.tagName === 'DIV'){
            return el;
        }
    }
    return null;
}

function firstAncestorWithMultipleChildren (el) {
    while ((el = el.parentElement) && (el.childElementCount == 1));
    return el;
}

// Implementation of https://developer.mozilla.org/en-US/docs/Web/API/Element/closest
function findClosest (el, selector) {
    while ((el = el.parentElement) && !el.matches(selector));
    return el;
}

function httpGetSync(theUrl) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "GET", theUrl, false );
    xmlHttp.send( null );
    return xmlHttp.responseText;
}

function isNestedInTable(el) {
    while ((el = el.parentElement)){
        if(el.tagName === 'TD'){
            return true;
        }
    }
    return false;
}

exports.getDictionaryFromSrcset = getDictionaryFromSrcset;
exports.firstDivAncestor = firstDivAncestor;
exports.firstAncestorWithMultipleChildren = firstAncestorWithMultipleChildren;
exports.findClosest = findClosest;
exports.httpGetSync = httpGetSync;
exports.isNestedInTable = isNestedInTable;

},{}],17:[function(require,module,exports){
(function (global){

var _topElement = null;
var _preRotationOffsetY = null;

function setPreRotationRelativeScrollOffset() {
    _topElement = document.elementFromPoint( window.innerWidth / 2, 0 );
    if (_topElement) {
        var rect = _topElement.getBoundingClientRect();
        _preRotationOffsetY = rect.top / rect.height;
    } else {
        _preRotationOffsetY = null;
    }
}

function getPostRotationScrollOffset() {
    if (_topElement && (_preRotationOffsetY !== null)) {
        var rect = _topElement.getBoundingClientRect();
        _topElement = null;
        return (window.scrollY + rect.top) - (_preRotationOffsetY * rect.height);
    } else {
        _topElement = null;
        return 0;
    }
}

global.setPreRotationRelativeScrollOffset = setPreRotationRelativeScrollOffset;
global.getPostRotationScrollOffset = getPostRotationScrollOffset;

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}]},{},[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17])