import React, { PureComponent } from 'react'
import { Image, View, PixelRatio, PanResponder } from 'react-native'
import Svg, { Polyline, Polygon } from 'react-native-svg'

import debounce from './debounce'

const DEBOUNCE_DELAY = 60
const CLICK_TOLERANCE = 2

const NOOP = () => { }

export const providers = {
  osm: (x, y, z) => {
    const s = String.fromCharCode(97 + (x + y + z) % 3)
    return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`
  },
  otm: (x, y, z) => {
    const s = String.fromCharCode(97 + (x + y + z) % 3)
    return `https://${s}.tile.opentopomap.org/${z}/${x}/${y}.png`
  },
  digiglobe: (x, y, z) => {
    const s = String.fromCharCode(97 + (x + y + z) % 3)
    return `https://${s}.tiles.mapbox.com/v4/digitalglobe.316c9a2e/${z}/${x}/${y}.png?access_token=pk.eyJ1IjoiZGlnaXRhbGdsb2JlIiwiYSI6ImNqZGFrZ2c2dzFlMWgyd2x0ZHdmMDB6NzYifQ.9Pl3XOO82ArX94fHV289Pg`
  },
  wikimedia: (x, y, z, dpr) => {
    return `https://maps.wikimedia.org/osm-intl/${z}/${x}/${y}${dpr >= 2 ? '@2x' : ''}.png`
  },
  stamen: (x, y, z, dpr) => {
    return `https://stamen-tiles.a.ssl.fastly.net/terrain/${z}/${x}/${y}${dpr >= 2 ? '@2x' : ''}.jpg`
  },
  sputnik: (x, y, z, dpr) => {
    return `http://tiles.maps.sputnik.ru/${z}/${x}/${y}.png?apikey=5032f91e8da6431d8605-f9c0c9a00357`
  },
  wikimapia: (x, y, z, dpr) => {
    const num = x % 4 + (y % 4) * 4
    return `http://i${num}.wikimapia.org/?x=${x}&y=${y}&zoom=${z}&lng=1`
  },
  dark: (x, y, z) => {
    const s = String.fromCharCode(97 + (x + y + z) % 3)
    return `https://cartodb-basemaps-${s}.global.ssl.fastly.net/dark_all/${z}/${x}/${y}.png`
  },
}

export default class Map extends PureComponent {
  panRef = React.createRef();
  pinchRef = React.createRef();

  static defaultProps = {
    minZoom: 1,
    maxZoom: 18,
    markers: [],
    geojson: [],
  }

  constructor(props) {
    super(props)

    this.syncToProps = debounce(this.syncToProps, DEBOUNCE_DELAY)
    this.pixi = null
    this._centerTarget = null
    this._zoomTarget = null

    // When users are using uncontrolled components we have to keep this
    // so we can know if we should call onBoundsChanged
    this._lastZoom = props.defaultZoom ? props.defaultZoom : props.zoom
    this._lastCenter = props.defaultCenter ? props.defaultCenter : props.center
    this._boundsSynced = false
    this._minMaxCache = null
    // minLat, maxLat, minLng, maxLng
    this.absoluteMinMax = [
      this.tile2lat(Math.pow(2, 10), 10),
      this.tile2lat(0, 10),
      this.tile2lng(0, 10),
      this.tile2lng(Math.pow(2, 10), 10)
    ]

    this.state = {
      zoom: this._lastZoom,
      center: this._lastCenter,
      width: props.width || props.defaultWidth,
      height: props.height || props.defaultHeight,
      zoomDelta: 0,
      pixelDelta: [0, 0],
      oldTiles: [],
      deltaX: 0,
      deltaY: 0,
      deltaScale: 0,
    }
  }

  componentDidMount() {
    this.syncToProps()
  }

  componentWillMount() {
    this.pan = PanResponder.create({
      onPanResponderGrant: this.onMoveStart,
      onPanResponderMove: this.onMove,
      onPanResponderEnd: this.onMoveEnd,
      onResponderRelease: this.onTouchUp,

      onPanResponderTerminate: () => true,
      onShouldBlockNativeResponder: () => true,
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => true,
      onMoveShouldSetPanResponderCapture: (event, { dx, dy }) => (
        dx !== 0 && dy !== 0
      ),
    });
  }

  componentWillReceiveProps(nextProps) {
    if (!nextProps.center && !nextProps.zoom) {
      // if the user isn't controlling neither zoom nor center we don't have to update.
      return
    }
    if (
      (
        !nextProps.center ||
        (
          nextProps.center[0] === this.props.center[0] &&
          nextProps.center[1] === this.props.center[1]
        )
      ) &&
      nextProps.zoom === this.props.zoom
    ) {
      // if the user is controlling either zoom or center but nothing changed
      // we don't have to update aswell
      return
    }

    const currentCenter = this._isAnimating ? this._centerTarget : this.state.center
    const currentZoom = this._isAnimating ? this._zoomTarget : this.state.zoom

    const nextCenter = nextProps.center || currentCenter // prevent the rare null errors
    const nextZoom = nextProps.zoom || currentZoom

    if (Math.abs(nextZoom - currentZoom) > 0.001 ||
      Math.abs(nextCenter[0] - currentCenter[0]) > 0.0001 ||
      Math.abs(nextCenter[1] - currentCenter[1]) > 0.0001) {
      this.setCenterZoom(nextCenter, nextZoom, true)
    }
  }

  distanceInScreens = (centerTarget, zoomTarget, center, zoom) => {
    const { width, height } = this.props

    // distance in pixels at the current zoom level
    const l1 = this.latLngToPixel(center, center, zoom)
    const l2 = this.latLngToPixel(centerTarget, center, zoom)

    // distance in pixels at the target zoom level (could be the same)
    const z1 = this.latLngToPixel(center, center, zoomTarget)
    const z2 = this.latLngToPixel(centerTarget, center, zoomTarget)

    // take the average between the two and divide by width or height to get the distance multiplier in screens
    const w = (Math.abs(l1[0] - l2[0]) + Math.abs(z1[0] - z2[0])) / 2 / width
    const h = (Math.abs(l1[1] - l2[1]) + Math.abs(z1[1] - z2[1])) / 2 / height

    // return the distance
    return Math.sqrt(w * w + h * h)
  }

  limitCenterAtZoom = (center, zoom) => {
    // [minLat, maxLat, minLng, maxLng]
    const minMax = this.getBoundsMinMax(zoom || this.state.zoom)

    return [
      Math.max(Math.min(isNaN(center[0]) ? this.state.center[0] : center[0], minMax[1]), minMax[0]),
      Math.max(Math.min(isNaN(center[1]) ? this.state.center[1] : center[1], minMax[3]), minMax[2])
    ]
  }

  // main logic when changing coordinates
  setCenterZoom = (center, zoom) => {
    const limitedCenter = this.limitCenterAtZoom(center, zoom)

    if (Math.round(this.state.zoom) !== Math.round(zoom)) {
      const tileValues = this.tileValues(this.state)
      const nextValues = this.tileValues({ center: limitedCenter, zoom, width: this.state.width, height: this.state.height })
      const oldTiles = this.state.oldTiles

      this.setState({
        oldTiles: oldTiles.filter(o => o.roundedZoom !== tileValues.roundedZoom).concat(tileValues)
      }, NOOP)

      let loadTracker = {}

      for (let x = nextValues.tileMinX; x <= nextValues.tileMaxX; x++) {
        for (let y = nextValues.tileMinY; y <= nextValues.tileMaxY; y++) {
          let key = `${x}-${y}-${nextValues.roundedZoom}`
          loadTracker[key] = false
        }
      }

      this._loadTracker = loadTracker
    }

    this.setState({ center: limitedCenter, zoom }, NOOP)
    const maybeZoom = this.props.zoom ? this.props.zoom : this._lastZoom
    const maybeCenter = this.props.center ? this.props.center : this._lastCenter
    if (Math.abs(maybeZoom - zoom) > 0.001 ||
      Math.abs(maybeCenter[0] - limitedCenter[0]) > 0.00001 ||
      Math.abs(maybeCenter[1] - limitedCenter[1]) > 0.00001) {
      this._lastZoom = zoom
      this._lastCenter = [...limitedCenter]
      this.syncToProps(limitedCenter, zoom)
    }
  }

  getBoundsMinMax = (zoom) => {
    if (this.props.limitBounds === 'center') {
      return this.absoluteMinMax
    }

    const { width, height } = this.state

    if (this._minMaxCache &&
      this._minMaxCache[0] === zoom &&
      this._minMaxCache[1] === width &&
      this._minMaxCache[2] === height) {
      return this._minMaxCache[3]
    }

    const pixelsAtZoom = Math.pow(2, zoom) * 256

    const minLng = width > pixelsAtZoom ? 0 : this.tile2lng(width / 512, zoom) // x
    const minLat = height > pixelsAtZoom ? 0 : this.tile2lat(Math.pow(2, zoom) - height / 512, zoom) // y

    const maxLng = width > pixelsAtZoom ? 0 : this.tile2lng(Math.pow(2, zoom) - width / 512, zoom) // x
    const maxLat = height > pixelsAtZoom ? 0 : this.tile2lat(height / 512, zoom) // y

    const minMax = [minLat, maxLat, minLng, maxLng]

    this._minMaxCache = [zoom, width, height, minMax]

    return minMax
  }

  srcSet = (dprs, url, x, y, z) => {
    if (!dprs || dprs.length === 0) {
      return ''
    }
    return dprs.map(dpr => url(x, y, z, dpr) + (dpr === 1 ? '' : ` ${dpr}x`)).join(', ')
  }

  imageLoaded = (key) => {
    if (this._loadTracker && key in this._loadTracker) {
      this._loadTracker[key] = true

      const unloadedCount = Object.keys(this._loadTracker).filter(k => !this._loadTracker[k]).length

      if (unloadedCount === 0) {
        this.setState({ oldTiles: [] }, NOOP)
      }
    }
  }

  getBounds = (center = this.state.center, zoom = this.zoomPlusDelta()) => {
    const { width, height } = this.state

    return {
      ne: this.pixelToLatLng([width - 1, 0], center, zoom),
      sw: this.pixelToLatLng([0, height - 1], center, zoom)
    }
  }

  syncToProps = (center = this.state.center, zoom = this.state.zoom) => {
    const { onBoundsChanged } = this.props

    if (onBoundsChanged) {
      const bounds = this.getBounds(center, zoom)

      onBoundsChanged({ center, zoom, bounds, initial: !this._boundsSynced })
      this._boundsSynced = true
    }
  }

  // tools
  lng2tile = (lon, zoom) => (lon + 180) / 360 * Math.pow(2, zoom)

  lat2tile = (lat, zoom) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)

  tile2lng = (x, z) => (x / Math.pow(2, z) * 360 - 180)

  tile2lat = (y, z) => {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z)
    return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))))
  }

  zoomPlusDelta = () => {
    return this.state.zoom + this.state.zoomDelta
  }

  pixelToLatLng = (pixel, center = this.state.center, zoom = this.zoomPlusDelta()) => {
    const { width, height, pixelDelta } = this.state

    const pointDiff = [
      (pixel[0] - width / 2 - (pixelDelta ? pixelDelta[0] : 0)) / 256.0,
      (pixel[1] - height / 2 - (pixelDelta ? pixelDelta[1] : 0)) / 256.0
    ]

    const tileX = this.lng2tile(center[1], zoom) + pointDiff[0]
    const tileY = this.lat2tile(center[0], zoom) + pointDiff[1]

    return [
      Math.max(this.absoluteMinMax[0], Math.min(this.absoluteMinMax[1], this.tile2lat(tileY, zoom))),
      Math.max(this.absoluteMinMax[2], Math.min(this.absoluteMinMax[3], this.tile2lng(tileX, zoom)))
    ]
  }

  latLngToPixel = (latLng, center = this.state.center, zoom = this.zoomPlusDelta()) => {
    const { width, height, pixelDelta } = this.state

    const tileCenterX = this.lng2tile(center[1], zoom)
    const tileCenterY = this.lat2tile(center[0], zoom)

    const tileX = this.lng2tile(latLng[1], zoom)
    const tileY = this.lat2tile(latLng[0], zoom)
    return [
      (tileX - tileCenterX) * 256.0 + width / 2 + (pixelDelta ? pixelDelta[0] : 0),
      (tileY - tileCenterY) * 256.0 + height / 2 + (pixelDelta ? pixelDelta[1] : 0)
    ]
  }

  calculateZoomCenter = (center, coords, oldZoom, newZoom) => {
    const { width, height } = this.state

    const pixelBefore = this.latLngToPixel(coords, center, oldZoom)
    const pixelAfter = this.latLngToPixel(coords, center, newZoom)

    const newCenter = this.pixelToLatLng([
      width / 2 + pixelAfter[0] - pixelBefore[0],
      height / 2 + pixelAfter[1] - pixelBefore[1]
    ], center, newZoom)

    return this.limitCenterAtZoom(newCenter, newZoom)
  }

  // data to display the tiles

  tileValues(state) {
    const { center, zoom, pixelDelta, zoomDelta, width, height } = state

    const roundedZoom = Math.round(zoom + (zoomDelta || 0))
    const zoomDiff = zoom + (zoomDelta || 0) - roundedZoom

    const scale = Math.pow(2, zoomDiff)
    const scaleWidth = width / scale
    const scaleHeight = height / scale

    const tileCenterX = this.lng2tile(center[1], roundedZoom) - (pixelDelta ? pixelDelta[0] / 256.0 / scale : 0)
    const tileCenterY = this.lat2tile(center[0], roundedZoom) - (pixelDelta ? pixelDelta[1] / 256.0 / scale : 0)

    const halfWidth = scaleWidth / 2 / 256.0
    const halfHeight = scaleHeight / 2 / 256.0

    const tileMinX = Math.floor(tileCenterX - halfWidth)
    const tileMaxX = Math.floor(tileCenterX + halfWidth)

    const tileMinY = Math.floor(tileCenterY - halfHeight)
    const tileMaxY = Math.floor(tileCenterY + halfHeight)

    return {
      tileMinX,
      tileMaxX,
      tileMinY,
      tileMaxY,
      tileCenterX,
      tileCenterY,
      roundedZoom,
      zoomDelta: zoomDelta || 0,
      scaleWidth,
      scaleHeight,
      scale
    }
  }

  onMoveStart = ({ nativeEvent }) => {
    const touches = nativeEvent.touches.filter(x => !!x)
    const touch = touches[0]
    const t1 = [touch.pageX, touch.pageY]
    this._touchStartPixel = [t1]
  }

  onMove = ({ nativeEvent }, gestureState) => {
    const touches = nativeEvent.touches.filter(x => !!x)
    if (touches.length === 1 && this._touchStartPixel) {
      const touch = touches[0]
      const pixel = [touch.pageX, touch.pageY]
      if (!this._touchStartPixel) {
        this._touchStartPixel = [pixel]
      }
      this.setState({
        pixelDelta: [
          pixel[0] - this._touchStartPixel[0][0],
          pixel[1] - this._touchStartPixel[0][1]
        ]
      }, NOOP)
    } else if (touches.length === 2 && this._touchStartPixel) {
      const { width, height, zoom } = this.state
      const t1 = [touches[0].pageX, touches[0].pageY]
      const t2 = [touches[1].pageX, touches[1].pageY]
      if (!this._touchStartMidPoint || !this._touchStartDistance) {
        this._touchStartPixel = [t1, t2]
        this._touchStartMidPoint = [
          (t1[0] + t2[0]) / 2,
          (t1[1] + t2[1]) / 2
        ]
        this._touchStartDistance = Math.sqrt(
          Math.pow(t1[0] - t2[0], 2) +
          Math.pow(t1[1] - t2[1], 2)
        )
      }
      const midPoint = [(t1[0] + t2[0]) / 2, (t1[1] + t2[1]) / 2]
      const midPointDiff = [midPoint[0] - this._touchStartMidPoint[0], midPoint[1] - this._touchStartMidPoint[1]]
      const distance = Math.sqrt(Math.pow(t1[0] - t2[0], 2) + Math.pow(t1[1] - t2[1], 2))
      const zoomDelta = Math.max(this.props.minZoom, Math.min(this.props.maxZoom, zoom + Math.log2(distance / this._touchStartDistance))) - zoom
      const scale = Math.pow(2, zoomDelta)

      const centerDiffDiff = [
        (width / 2 - midPoint[0]) * (scale - 1),
        (height / 2 - midPoint[1]) * (scale - 1)
      ]
      this.setState({
        zoomDelta: zoomDelta,
        pixelDelta: [
          centerDiffDiff[0] + midPointDiff[0] * scale,
          centerDiffDiff[1] + midPointDiff[1] * scale
        ]
      }, NOOP)
    }
  }

  onMoveEnd = ({ nativeEvent }) => {
    const { center, zoom } = this.sendDeltaChange()
    if (this._touchStartPixel == null) {
      return
    }
    const oldTouchPixel = this._touchStartPixel[0]
    const newTouchPixel = [nativeEvent.changedTouches[0].pageX, nativeEvent.changedTouches[0].pageY]

    if (
      Math.abs(oldTouchPixel[0] - newTouchPixel[0]) > CLICK_TOLERANCE ||
      Math.abs(oldTouchPixel[1] - newTouchPixel[1]) > CLICK_TOLERANCE
    ) {
      this.setCenterZoom(center, zoom)
    }

    this._touchStartPixel = null
    this._touchStartMidPoint = null
    this._touchStartDistance = null
  }

  sendDeltaChange = () => {
    const { center, zoom, pixelDelta, zoomDelta } = this.state

    let lat = center[0]
    let lng = center[1]

    if (pixelDelta || zoomDelta !== 0) {
      lng = this.tile2lng(this.lng2tile(center[1], zoom + zoomDelta) - (pixelDelta ? pixelDelta[0] / 256.0 : 0), zoom + zoomDelta)
      lat = this.tile2lat(this.lat2tile(center[0], zoom + zoomDelta) - (pixelDelta ? pixelDelta[1] / 256.0 : 0), zoom + zoomDelta)
      this.setCenterZoom([lat, lng], zoom + zoomDelta)
    }

    this.setState({
      pixelDelta: null,
      zoomDelta: 0
    }, NOOP)

    return {
      center: this.limitCenterAtZoom([lat, lng], zoom + zoomDelta),
      zoom: zoom + zoomDelta
    }
  }

  // Markers

  renderMarkers = () => {
    if (!this.state.width || !this.state.height || !this.state.pixelDelta) {
      return null
    }
    const { center, zoom, pixelDelta, zoomDelta, width, height } = this.state
    const roundedZoom = Math.round(zoom + (zoomDelta || 0))
    const zoomDiff = zoom + (zoomDelta || 0) - roundedZoom
    const scale = Math.pow(2, zoomDiff)
    const bounds = this.getBounds()
    const dx = - (pixelDelta ? pixelDelta[0] / 256.0 / scale : 0)
    const dy = - (pixelDelta ? pixelDelta[1] / 256.0 / scale : 0)
    const childrenWithProps = React.Children.map(this.props.children, child => {
      const coords = child.props.coords
      if (coords[0] > bounds.ne[0] || coords[0] < bounds.sw[0] || coords[1] > bounds.ne[1] || coords[1] < bounds.sw[1]) {
        return null
      }
      const xy = this.latLngToPixel(coords, center, zoom + zoomDelta)

      return <View style={[{
        left: xy[0] + dx - (child.props.width || 32) / 2, top: xy[1] + dy - (child.props.height || 32) / 2, position: 'absolute'
      }, child.props.style]}>{React.cloneElement(child, {})}</View>
    });
    return childrenWithProps
  }

  renderFeatures = () => {
    const { center, zoom, pixelDelta, zoomDelta, width, height } = this.state
    const roundedZoom = Math.round(zoom + (zoomDelta || 0))
    const zoomDiff = zoom + (zoomDelta || 0) - roundedZoom
    const scale = Math.pow(2, zoomDiff)
    const bounds = this.getBounds()
    const dx = - (pixelDelta ? pixelDelta[0] / 256.0 / scale : 0)
    const dy = - (pixelDelta ? pixelDelta[1] / 256.0 / scale : 0)
    //const xy = this.latLngToPixel(coords, center, zoom + zoomDelta)
    return this.props.features.map((feature, idx) => {
      switch (feature.type.toLowerCase()) {
        case 'multiline':
          return <Polyline
            key={idx}
            points={feature.coords.map(coords => this.latLngToPixel(coords, center, zoom + zoomDelta).join(',')).join(' ')}
            fill="none"
            stroke={feature.stroke || 'rgba(0,0,255, 0.9)'}
            strokeWidth={feature.strokeWidth || 3}
          />
        case 'polygon':
          return <Polygon
            key={idx}
            points={feature.coords.map(coords => this.latLngToPixel(coords, center, zoom + zoomDelta).join(',')).join(' ')}
            fill={feature.fill || 'rgba(0,0,255, 0.3)'}
            stroke={feature.stroke || 'rgba(0,0,255, 0.9)'}
            strokeWidth={feature.strokeWidth || 3}
          />
      }
    })
  }
  // display the tiles

  renderTiles = () => {
    const { oldTiles } = this.state
    const dprs = [1, PixelRatio.get()]
    const mapUrl = this.props.provider || providers['wikimedia']

    const {
      tileMinX,
      tileMaxX,
      tileMinY,
      tileMaxY,
      tileCenterX,
      tileCenterY,
      roundedZoom,
      scaleWidth,
      scaleHeight,
      scale
    } = this.tileValues(this.state)

    let tiles = []
    const left = -((tileCenterX - tileMinX) * 256 - scaleWidth / 2)
    const top = -((tileCenterY - tileMinY) * 256 - scaleHeight / 2)

    for (let i = 0; i < oldTiles.length; i++) {
      let old = oldTiles[i]
      let zoomDiff = old.roundedZoom - roundedZoom

      if (Math.abs(zoomDiff) > 4 || zoomDiff === 0) {
        continue
      }

      let pow = 1 / Math.pow(2, zoomDiff)
      let xDiff = -(tileMinX - old.tileMinX * pow) * 256
      let yDiff = -(tileMinY - old.tileMinY * pow) * 256

      let xMin = Math.max(old.tileMinX, 0)
      let yMin = Math.max(old.tileMinY, 0)
      let xMax = Math.min(old.tileMaxX, Math.pow(2, old.roundedZoom) - 1)
      let yMax = Math.min(old.tileMaxY, Math.pow(2, old.roundedZoom) - 1)

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          tiles.push({
            key: `${x}-${y}-${old.roundedZoom}`,
            url: mapUrl(x, y, old.roundedZoom),
            srcSet: this.srcSet(dprs, mapUrl, x, y, old.roundedZoom),
            left: (xDiff + (x - old.tileMinX) * 256 * pow + left) * scale,
            top: (yDiff + (y - old.tileMinY) * 256 * pow + top) * scale,
            width: 256 * pow * scale,
            height: 256 * pow * scale,
            active: false,
            opacity: 1,
          })
        }
      }
    }

    let xMin = Math.max(tileMinX, 0)
    let yMin = Math.max(tileMinY, 0)
    let xMax = Math.min(tileMaxX, Math.pow(2, roundedZoom) - 1)
    let yMax = Math.min(tileMaxY, Math.pow(2, roundedZoom) - 1)


    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const key = `${x}-${y}-${roundedZoom}`
        tiles.push({
          key,
          url: mapUrl(x, y, roundedZoom),
          srcSet: this.srcSet(dprs, mapUrl, x, y, roundedZoom),
          left: ((x - tileMinX) * 256 + left) * scale,
          top: ((y - tileMinY) * 256 + top) * scale,
          width: 256 * scale,
          height: 256 * scale,
          active: true,
          opacity: 1,
        })
      }
    }

    return tiles.map(tile => (<Image
      key={tile.key}
      source={{ uri: tile.url, cache: 'force-cache' }}
      resizeMethod={"scale"}
      style={{
        height: tile.height,
        width: tile.width,
        left: tile.left,
        top: tile.top,
        position: 'absolute',
        opacity: tile.opacity
      }}
      onLoad={() => this.imageLoaded(tile.key)}
    />
    ))
  }

  render() {

    return (<View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        this.setState({ width, height })
      }}
      {...this.pan.panHandlers}
      style={[{ flex: 1, overflow: 'hidden' }, this.props.style]}
    >
      {this.renderTiles()}
      <Svg style={{ flex: 1 }}>
        {this.renderFeatures()}
      </Svg>
      {this.renderMarkers()}
    </View>)
  }
}

