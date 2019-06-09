# React Native Raster Maps

Based on https://pigeon-maps.js.org/.

## Usage:

```
<Map
  center={[55.796289, 49.108795]}
  zoom={6}
  provider={providers['osm']}
  features={[
    { type: "multiline", coords: [[55.796289, 49.108795], [55.790289, 49.108095]] },
    { type: "polygon", coords: [[55.706289, 49.108795], [55.790289, 49.118095], [55.700289, 49.128095]] }
  ]}
  onBoundsChanged={this.onBoundsChanged}
>
  <Marker coords={[55.796289, 49.108795]} height={32} width={32} style={{ height: 32, width: 32, borderRadius: 16, backgroundColor: '#f00' }} />
  <Marker coords={[55.790289, 49.108095]} height={32} width={32} style={{ height: 32, width: 32, borderRadius: 16, backgroundColor: '#f00' }} />
</Map>
```

## Providers:

* osm
* otm
* digiglobe
* wikimedia
* stamen
* sputnik
* wikimapia
* dark

Own provider:

```
<Map
  provider={(x,y,z,dpr) => `http://map.example.ru/${x}/${y}/${z}.png`}
/>
```