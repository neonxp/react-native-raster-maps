import React from 'react';

export default class Marker extends React.PureComponent {
    render() {
        return this.props.children || null
    }
}