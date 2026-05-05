import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;


export default class PassSearchProviderExtension extends Extension {
  enable() {
    console.log(`Enabling ${this.metadata.name}`);
    this.instance = new SearchProvider();
    getOverviewSearchResult()._registerProvider(this.instance);
  }

  disable() {
    console.log(`Disabling ${this.metadata.name}`);
    getOverviewSearchResult()._unregisterProvider(this.instance);
    this.instance = null;
  }
}


function getOverviewSearchResult() {
  return Main.overview._overview.controls._searchController._searchResults;
}


class SearchProvider {

  constructor() {
    this.clipboard = St.Clipboard.get_default();
    this.entryIcon = Gio.ThemedIcon.new_with_default_fallbacks(`dialog-password-symbolic`);

    const keyfile = new GLib.KeyFile();
    keyfile.set_string('Desktop Entry', 'Type', 'Application');
    keyfile.set_string('Desktop Entry', 'Name', 'Pass');
    keyfile.set_string('Desktop Entry', 'Icon', 'password-app-symbolic');
    keyfile.set_string('Desktop Entry', 'Exec', 'pass');
    this.appInfo = Gio.DesktopAppInfo.new_from_keyfile(keyfile);
  }

  async getInitialResultSet(terms, _cancellable) {
    this.fileTree = new PassStoreFileTree();
    return this._searchInFileTree(terms);
  }

  async getSubsearchResultSet(_previousResults, terms, _cancellable) {
    return this._searchInFileTree(terms);
  }

  _searchInFileTree(terms) {
    let longEnough = terms.filter(term => term.length >= 2).length > 0;
    if (longEnough) {
      return this.fileTree.find(terms);
    } else {
      return [];
    }
  }

  async getResultMetas(results, _cancellable) {
    let self = this;
    let getMeta = (entry) => {
      let info = this.fileTree.get(entry);
      return {
        id: entry,
        name: info.shortName,
        description: entry,
        createIcon(size) {
          return new St.Icon({
            gicon: self.entryIcon,
            icon_size: size
          });
        }
      };
    };
    return results.map(getMeta);
  }

  activateResult(entry) {
    let sub = Gio.Subprocess.new(['pass', 'show', entry], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    sub.communicate_utf8_async(null, null, (_, res) => {
      let [ok, stdout, stderr] = sub.communicate_utf8_finish(res);
      let message;
      if (stderr) {
        message = stderr;
      } else {
        let lines = stdout.split(/\r?\n/);
        this.clipboard.set_text(CLIPBOARD_TYPE, lines[0]);
        message = `Copied ${entry} to clipboard`;
      }
      Main.notify("Pass", message);
    });
  }

  filterResults(providerResults, maxResults) {
    return providerResults.slice(0, maxResults);
  }
}


class PassStoreFileTree {

  constructor() {
    let storePath = GLib.build_filenamev([GLib.get_home_dir(), ".password-store"]);
    let storeRootDir = Gio.File.new_for_path(storePath);
    this.entries = [];
    this.files = {};
    for (const [name, file] of enumerateGpgFiles(storeRootDir, [])) {
      let path = storeRootDir.get_relative_path(file).slice(0, -4); // remove .gpg part
      let directory = storeRootDir.get_relative_path(file.get_parent());
      let shortName = name.slice(0, -4);
      this.entries.push(path);
      this.files[path] = {
        shortName,
        directory,
        file
      };
    }
  }

  find(terms) {
    return this.entries.filter(f => terms.every(term => f.includes(term)));
  }

  get(entry) {
    return this.files[entry];
  }
}


function enumerateGpgFiles(dir, result) {
  let enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
  let info;
  while ((info = enumerator.next_file(null))) {
    let type = info.get_file_type();
    let name = info.get_name();
    let child = enumerator.get_child(info);
    if (type == Gio.FileType.REGULAR && name.endsWith('.gpg')) {
      result.push([name, child]);
    }
    else if (type == Gio.FileType.DIRECTORY && !info.get_is_hidden())
      enumerateGpgFiles(child, result);
  }
  return result;
}
