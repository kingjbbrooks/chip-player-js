/* eslint import/no-webpack-loader-syntax: off */
import React, {PureComponent} from 'react';
import SearchWorker from 'worker-loader!./SearchWorker';
import queryString from 'querystring';
import FavoriteButton from "./FavoriteButton";

const searchWorker = new SearchWorker();

const CATALOG_PREFIX = 'https://gifx.co/music/';
const MAX_RESULTS = 200;

function getSearch(query, limit) {
  const q = encodeURIComponent(query);
  const l = limit || MAX_RESULTS;
  return fetch(`https://gifx.co/chip/search?query=${q}&limit=${l}`)
    .then(response => response.json());
}

function getTotal() {
  return fetch(`https://gifx.co/chip/total`)
    .then(response => response.json());
}

export default class Search extends PureComponent {
  constructor(props) {
    super(props);

    this.doSearch = this.doSearch.bind(this);
    this.onChange = this.onChange.bind(this);
    this.onSearchInputChange = this.onSearchInputChange.bind(this);
    this.handleSearchResults = this.handleSearchResults.bind(this);
    this.handleGroupClick = this.handleGroupClick.bind(this);
    this.handleStatus = this.handleStatus.bind(this);
    this.handleClear = this.handleClear.bind(this);
    this.renderResultItem = this.renderResultItem.bind(this);

    this.textInput = React.createRef();

    searchWorker.onmessage = (message) => this.handleMessage(message.data);

    if (props.catalog) {
      this.loadCatalog(props.catalog);
    }

    this.state = {
      searching: false,
      results: {},
      resultsCount: 0,
      totalSongs: 0,
      query: null,
    };

    getTotal()
      .then(json => this.setState({ totalSongs: json.total }))
      .catch(_ => this.setState({ totalSongs: 99999 }));
  }

  componentDidUpdate(prevProps) {
    if (!this.catalogLoaded && this.props.catalog) {
      this.loadCatalog(this.props.catalog);
    } else {
      if (this.props.initialQuery !== prevProps.initialQuery) {
        this.onSearchInputChange(this.props.initialQuery);
      }
    }
  }

  loadCatalog(catalog) {
    if (window.BACKEND_SEARCH) return;
    console.log('Posting catalog load message to worker...');
    this.catalogLoaded = true;
    searchWorker.postMessage({
      type: 'load',
      payload: JSON.stringify(catalog),
    });
  }

  onChange(e) {
    this.onSearchInputChange(e.target.value);
  }

  onSearchInputChange(val) {
    this.setState({query: val});
    const urlParams = {
      q: val ? val.trim() : undefined,
    };
    const stateUrl = '?' + queryString.stringify(urlParams).replace(/%20/g, '+');
    window.history.replaceState(null, '', stateUrl);
    if (val.length) {
      this.doSearch(val);
    } else {
      this.showEmptyState();
    }
  }

  doSearch(val) {
    if (window.BACKEND_SEARCH) {
      getSearch(val)
        .then(json => this.handleSearchResults(json));
    } else {
      const query = val.trim().split(' ').filter(n => n !== '');
      searchWorker.postMessage({
        type: 'search',
        payload: {
          query: query,
          maxResults: MAX_RESULTS
        }
      });
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'results':
        this.handleSearchResults(data.payload);
        break;
      case 'status':
        this.handleStatus(data.payload);
        break;
      default:
    }
  }

  handleStatus(data) {
    if (data.numRecords && this.props.initialQuery) {
      this.onSearchInputChange(this.props.initialQuery);
    }
    this.setState({
      totalSongs: data.numRecords,
    });
  }

  handleSearchResults(payload) {
    const results = payload.results.map(result => result.file).sort();
    this.setState({
      searching: true,
      resultsCount: payload.count,
      results: results,
      resultsHeadings: this.extractHeadings(results),
    });
  }

  handleClear() {
    window.history.replaceState(null, '', './');
    this.setState({
      query: null,
      searching: false,
      resultsCount: 0,
      results: {}
    });
    this.textInput.current.focus();
  }

  showEmptyState() {
    this.setState({searching: false, results: {}})
  }

  extractHeadings(sortedResults) {
    // Results input must be sorted. Returns a map of indexes to headings.
    // {
    //   0: 'Nintendo\A Boy And His Blob',
    //   12: 'Sega Genesis\A Boy And His Blob',
    // }
    const headings = {};
    let currHeading = null;
    sortedResults.forEach((result, i) => {
      const heading = result.substring(0, result.lastIndexOf('/') + 1);
      if (heading !== currHeading) {
        currHeading = heading;
        headings[i] = currHeading;
      }
    });
    return headings;
  }

  handleGroupClick(e, query) {
    e.preventDefault();
    this.onSearchInputChange(query);
  }

  renderResultItem(result, i) {
    let headingFragment = null;
    if (this.state.resultsHeadings[i]) {
      const heading = this.state.resultsHeadings[i];
      // HACK: in lieu of a browse capability, search for the directory
      const headingQuery = heading.replace(/[^a-zA-Z0-9]+/g, ' ');
      headingFragment = (
        <div className="Search-results-group-heading">
          <a href={'?q=' + headingQuery}
             onClick={(e) => this.handleGroupClick(e, headingQuery)}>
            {this.state.resultsHeadings[i]}
          </a>
        </div>
      );
    }
    // XXX: Escape immediately: the escaped URL is considered canonical.
    //      The URL must be decoded for display from here on out.
    const href = CATALOG_PREFIX + result.replace('%', '%25').replace('#', '%23');
    const resultTitle = result.substring(result.lastIndexOf('/') + 1);
    const isPlaying = this.props.currContext === this.state.results && this.props.currIdx === i;
    return (
      <div key={i}>
        {headingFragment}
        <div className="Search-results-group-item">
          {this.props.favorites &&
          <FavoriteButton favorites={this.props.favorites}
                          toggleFavorite={this.props.toggleFavorite}
                          href={href}/>}
          <a className={isPlaying ? 'Song-now-playing' : ''}
             onClick={this.props.onClick(href, this.state.results, i)}
             href={href}>
            {resultTitle}
          </a>
        </div>
      </div>
    );
  }

  render() {
    const placeholder = this.state.totalSongs ?
      `${this.state.totalSongs} tunes` : 'Loading catalog...';
    return (
      <div className="Search">
        <div>
          <label className="Search-label">Search:{' '}
            <input type="text"
                   placeholder={placeholder}
                   spellCheck="false"
                   autoComplete="off"
                   autoCorrect="false"
                   autoCapitalize="none"
                   ref={this.textInput}
                   value={this.state.totalSongs ? this.state.query || '' : ''}
                   onChange={this.onChange}/>
            {
              this.state.searching &&
              <span>
                <button className="Search-button-clear" onClick={this.handleClear}/>
                {' '}
                {this.state.resultsCount} result{this.state.resultsCount !== 1 && 's'}
              </span>
            }
          </label>
        </div>
        {
          this.state.searching ?
            <div className="Search-results">
              {this.state.results.map(this.renderResultItem)}
            </div>
            :
            this.props.children
        }
      </div>
    );
  }
}