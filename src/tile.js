import React, { Component } from "react";
import { Image, View, ActivityIndicator } from "react-native";
import * as FileSystem from 'expo-file-system';

export default class Tile extends Component {
    constructor(props) {
        super(props)
        this.state = {
            loaded: false,
            uri: '',
        }
    }
    componentDidMount() {
        this._mounted = true;
        this.load()
    }
    load = async () => {
        const fileUri = FileSystem.cacheDirectory + 'tiles/'  + this.props.tileKey + '.png'
        let finfo = await FileSystem.getInfoAsync(fileUri)
        if (!finfo.exists) {
            finfo = await FileSystem.downloadAsync(this.props.source, fileUri)
        }
        if (this._mounted) {
            this.setState({ loaded: true, uri: finfo.uri })
        }
        this.props.onLoad && this.props.onLoad()
    }
      
      componentWillUnmount() {
        this._mounted = false;
      }
    render() {
        if (!this.state.loaded) {
            return null
        }
        return (<Image style={this.props.style} source={{ uri: this.state.uri }} resizeMethod={"scale"} />)
    }
}