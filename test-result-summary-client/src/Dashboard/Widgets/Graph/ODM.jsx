import React, { Component } from 'react';
import {
    HighchartsStockChart, Chart, XAxis, YAxis, Legend,
    LineSeries, Navigator, RangeSelector, Tooltip
} from 'react-jsx-highstock';
import DateRangePickers from '../DateRangePickers';
import { Radio, Checkbox } from 'antd';
import math from 'mathjs';
import utils from './utils';

const map = {
    "Daily-ODM": "Daily-ODM-pxa64 | 881-4way-Seg5FastpathRVEJB",
    "Daily-ODM-Linux-PPCLE64": "Daily-ODM-pxl64 | 881-4way-Seg5FastpathRVEJB",
    "Daily-ODM-openJ9": "Daily-ODM-openJ9-pxa64 | 881-4way-Seg5FastpathRVEJB",
    "Daily-ODM-zLinux": "Daily-ODM-pxz64 | 881-4way-Seg5FastpathRVEJB",
    "Daily-ODM-zOS": "Daily-ODM-pmz64 | 881-4way-Seg5FastpathRVEJB"
};

let display = {
    "Daily-ODM": true,
    "Daily-ODM-Linux-PPCLE64": true,
    "Daily-ODM-openJ9": true,
    "Daily-ODM-zLinux": true,
    "Daily-ODM-zOS": true
};

let baselineValue = 5500;

export class ODMSetting extends Component {
    onChange = obj => {
        for (let i in display) {
            display[i] = false;
        }
        for (let j in obj) {
            display[obj[j]] = true;
        }
        this.props.onChange( { buildSelected: obj[obj.length -1] } );
    }

    render() {
        const { buildSelected } = this.props;

        return <div style={{ maxWidth: 400 }}>
            <Checkbox.Group onChange={this.onChange} values={map.keys} defaultValue={["Daily-ODM"]}>
                {Object.keys( map ).map( key => {
                    return <Checkbox key={key} value={key} checked={false}>{map[key]}</Checkbox>;
                } )}
            </Checkbox.Group>
        </div>
    }
}

export default class ODM extends Component {
    static Title = props => map[props.buildSelected] || '';
    static defaultSize = { w: 2, h: 4 }
    static Setting = ODMSetting;
    static defaultSettings = {
        buildSelected: Object.keys( map )[0]
    }

    state = {
        displaySeries: [],
    };

    async componentDidMount() {
        await this.updateData();
    }

    async componentDidUpdate( prevProps ) {
        if ( prevProps.buildSelected !== this.props.buildSelected ) {
            await this.updateData();
        }
    }

    async updateData() {
        // when API ready => buildSelected will be list of builds
        let buildsName = '';
        for(let i in display) {
            if (display[i]) {
                buildsName += "buildName=" + i;
                if(i !== display.length - 1) {
                    buildsName += "&";
                }
            }
        }
        buildsName = buildsName.substring(0, buildsName.length - 1);
        const { buildSelected } = this.props;
        const buildName = encodeURIComponent( buildSelected );
        const response = await fetch( `/api/getBuildHistory?type=Perf&${buildsName}&status=Done&limit=100&asc`, {
            method: 'get'
        } );
        const results = await response.json();
        const resultsByJDKBuild = {};
        let globalThroughputs = {};
        let baseLine = [];
        let scale = baselineValue / 100;

        // combine results having the same JDK build date
        results.forEach(( t, i ) => {
            if ( t.buildResult !== "SUCCESS" ) return;

            // TODO: current code only considers one interation. This needs to be updated
            if ( t.tests[0].testData && t.tests[0].testData.metrics && t.tests[0].testData.metrics.length > 0 ) {
                const JDKBuildTimeConvert = t.tests[0].testData.jdkBuildDateUnixTime;
                if ( !t.tests[0].testData.metrics[0].value
                    || t.tests[0].testData.metrics[0].value.length === 0
                    || t.tests[0].testData.metrics[0].name !== "Global Throughput" ) {
                    return;
                }
                if(!resultsByJDKBuild[t.buildName]) {
                    resultsByJDKBuild[t.buildName] = {};
                }
                if(JDKBuildTimeConvert) {
                    resultsByJDKBuild[t.buildName][JDKBuildTimeConvert] = resultsByJDKBuild[JDKBuildTimeConvert] || [];
                    resultsByJDKBuild[t.buildName][JDKBuildTimeConvert].push( {
                        globalThroughput: t.tests[0].testData.metrics[0].value[0],
                        additionalData: {
                            testId: t.tests[0]._id,
                            buildName: t.buildName,
                            buildNum: t.buildNum,
                            javaVersion: t.tests[0].testData.javaVersion,
                        },
                    } );
                }
            }
        } );
        let baseLineData = [];
        Object.keys( resultsByJDKBuild ).forEach(( k, i ) => {
            if(!globalThroughputs[k]) {
                globalThroughputs[k] = [];
            }
            math.sort(Object.keys(resultsByJDKBuild[k])).forEach((a, b) => {
                globalThroughputs[k].push( [Number( a ), math.mean( resultsByJDKBuild[k][a].map( x => x['globalThroughput'] ) / scale), resultsByJDKBuild[k][a].map( x => x['additionalData'] )] );
                baseLineData.push([Number( a ), 100]);
            });
        } );

        const displaySeries = baseLine;
        for ( let key in globalThroughputs ) {
            displaySeries.push( {
                visible: key,
                name: key,
                data: globalThroughputs[key],
                keys: ['x', 'y', 'additionalData']
            } );
        }

        displaySeries.push({
            visible: 'baseLine',
            name: 'BaseLine',
            data: baseLineData,
            keys: ['x', 'y']
        })

        this.setState( { displaySeries } );
    }

    formatter = function() {
        const x = new Date( this.x );
        if ( this.point.additionalData ) {
            let buildLinks = '';
            let i = this.series.data.indexOf(this.point);
            let prevPoint = i === 0 ? null : this.series.data[i - 1];
            this.point.additionalData.forEach(( xy, i ) => {
                const { testId, buildName, buildNum } = xy;
                buildLinks = buildLinks + ` <a href="/output/test?id=${testId}">${buildName} #${buildNum}</a>`;
            } );

            let lengthThis = this.point.additionalData.length;
            let lengthPrev = prevPoint ? prevPoint.additionalData.length : 0;

            let javaVersion = this.point.additionalData[lengthThis - 1].javaVersion;
            let prevJavaVersion = prevPoint ? prevPoint.additionalData[lengthPrev - 1].javaVersion : null;
            let ret = `${this.series.name}: ${this.y}<br/> Build: ${x.toISOString().slice( 0, 10 )} <br/>Link to builds: ${buildLinks}`;

            prevJavaVersion = utils.parseSha(prevJavaVersion, 'OpenJ9');
            javaVersion = utils.parseSha(javaVersion, 'OpenJ9');

            if (prevJavaVersion && javaVersion) {
                let githubLink = `<a href="https://github.com/eclipse/openj9/compare/${prevJavaVersion}…${javaVersion}">Github Link </a>`;
                ret += `<br/> Compare Builds: ${githubLink}`;
            }
            return ret;
        } else {
            return `${this.series.name}: ${this.y}<br/> Build: ${x.toISOString().slice( 0, 10 )}`
        }
    }

    render() {
        const { displaySeries } = this.state;
        return <div className="app">
            <HighchartsStockChart>
                <Chart zoomType="x" />
                <Legend />
                <Tooltip formatter={this.formatter} useHTML={true} style={{ pointerEvents: 'auto' }} />

                <XAxis>
                    <XAxis.Title>Time</XAxis.Title>
                </XAxis>

                <YAxis id="gt">
                    <YAxis.Title>Global Throughput (% to baseline)</YAxis.Title>
                    {displaySeries.map( s => {
                        return <LineSeries {...s} id={s.name} key={s.name} />
                    } )}
                </YAxis>

                <DateRangePickers axisId="xAxis" />
                <RangeSelector>
                    <RangeSelector.Button count={1} type="day">1d</RangeSelector.Button>
                    <RangeSelector.Button count={7} type="day">7d</RangeSelector.Button>
                    <RangeSelector.Button count={1} type="month">1m</RangeSelector.Button>
                    <RangeSelector.Button type="all">All</RangeSelector.Button>
                </RangeSelector>

                <Navigator>
                    <Navigator.Series seriesId="globalThroughput" />
                    <Navigator.Series seriesId="mean" />
                </Navigator>
            </HighchartsStockChart>
        </div>
    }
}