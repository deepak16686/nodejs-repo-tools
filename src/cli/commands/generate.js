/**
 * Copyright 2017, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

require('colors');

const _ = require('lodash');
const execSync = require('child_process').execSync;
const fs = require('fs-extra');
const handlebars = require('handlebars');
const path = require('path');
const string = require('string');

const buildPack = require('../../build_packs').getBuildPack();
const options = require('../options');
const products = require('../../utils/products');
const utils = require('../../utils');

handlebars.registerHelper('slugify', (str) => string(str).slugify().s);
handlebars.registerHelper('trim', (str) => string(str).trim().s);
handlebars.registerHelper('release_quality', utils.createReleaseQualityBadge);
handlebars.registerHelper('syntax_highlighting_ext', (opts) => {
  const repoPath = path.parse(opts.data.root.repoPath).name.replace('google', '').replace('cloud', '');
  if (repoPath.includes('csharp') || repoPath.includes('dotnet')) {
    return 'cs';
  } else if (repoPath.includes('go')) {
    return 'go';
  } else if (repoPath.includes('java')) {
    return 'java';
  } else if (repoPath.includes('node')) {
    return 'js';
  } else if (repoPath.includes('php')) {
    return 'php';
  } else if (repoPath.includes('python')) {
    return 'python';
  } else if (repoPath.includes('ruby')) {
    return 'ruby';
  }
  return '';
});

function gatherHelpText (opts, buildPack) {
  (buildPack.config.samples || []).forEach((sample) => {
    if (typeof sample.usage === 'string') {
      sample.usage = {
        cmd: sample.usage,
        text: sample.usage
      };
    }
    if (!sample.help && sample.usage && typeof sample.usage.cmd === 'string') {
      try {
        sample.help = execSync(sample.usage.cmd, {
          cwd: opts.localPath
        }).toString().trim();
      } catch (err) {
        utils.logger.logger.error('generate', err.message);
        process.exit(err.status);
      }
    }
  });
}

function expandOpts (opts, buildPack) {
  opts.samples || (opts.samples = []);
  gatherHelpText(opts, buildPack);
}

const RE_REGION_TAG_START = /\[START ([\w_-]+)\]/g;
const RE_REGION_TAG_END = /\[END ([\w_-]+)\]/g;

function getQuickstart (filename) {
  if (!path.isAbsolute(filename)) {
    filename = path.join(buildPack._cwd, filename);
  }
  const content = fs.readFileSync(filename, 'utf-8');
  const lines = content.split('\n');
  let inRegion = false;
  let firstIdx = -1;
  let lastIdx = -1;

  lines.forEach((line, i) => {
    if (!inRegion) {
      const matches = line.match(RE_REGION_TAG_START);
      if (matches && matches[0] && matches[0].indexOf('quickstart') !== -1) {
        inRegion = true;
        if (firstIdx === -1) {
          firstIdx = i + 1;
        }
      }
    } else {
      const matches = line.match(RE_REGION_TAG_END);
      if (matches && matches[0] && matches[0].indexOf('quickstart') !== -1) {
        inRegion = false;
        if (lastIdx === -1) {
          lastIdx = i;
        }
      }
    }
  });

  return lines.slice(firstIdx, lastIdx).join('\n');
}

const TARGETS = buildPack.config.generate;
let availableTargetsStr = '';
Object.keys(TARGETS).forEach((target) => {
  availableTargetsStr += `  ${target.yellow}:  ${TARGETS[target].description}\n`;
});

const CLI_CMD = 'generate';
const COMMAND = `tools ${CLI_CMD} <targets..> ${'[options]'.yellow}`;
const DESCRIPTION = `Generate the given target(s) in ${buildPack._cwd.yellow}.`;

const USAGE = `Usage:
  ${COMMAND.bold}
Description:
  ${DESCRIPTION}

${'Available targets:'.bold}

${availableTargetsStr}`;

exports.command = `${CLI_CMD} <targets..>`;
exports.description = DESCRIPTION;

exports.builder = (yargs) => {
  yargs
    .usage(USAGE)
    .options({
      config: options.config,
      'config-key': options.configKey,
      data: {
        description: `${'Default:'.bold} ${`{}`.yellow}. JSON string, to be passed to the template.`,
        requiresArg: true,
        type: 'string'
      }
    });
};

exports.handler = (opts) => {
  if (opts.dryRun) {
    utils.logger.log(CLI_CMD, 'Beginning dry run.'.cyan);
  }

  if (opts.targets.indexOf('all') !== -1) {
    // Generate all targets
    opts.targets = Object.keys(TARGETS);
    opts.targets.splice(opts.targets.indexOf('all'), 1);
    opts.targets.splice(opts.targets.indexOf('lib_samples_readme'), 1);
    opts.targets.splice(opts.targets.indexOf('samples_readme'), 1);
  }

  buildPack.expandConfig(opts);
  utils.logger.log(CLI_CMD, `Generating ${opts.targets.join(', ')} in: ${opts.localPath.yellow}`);

  // The badgeUri is used for test status badges
  opts.repoPath = utils.getRepoPath(opts.repository, opts.localPath) || null;
  buildPack.config.cloudBuildBadgeUri = path.join('cloud-docs-samples-badges', opts.repoPath, opts.name);

  // Load associated product information, if any
  if (buildPack.config.product) {
    Object.keys(products[buildPack.config.product]).forEach((field) => {
      buildPack.config[field] = products[buildPack.config.product][field];
    });
  }

  // Generate each specified target
  opts.targets.forEach((target) => {
    const targetConfig = TARGETS[target];
    const targetPath = path.join(opts.localPath, targetConfig.filename);
    utils.logger.log(CLI_CMD, 'Compiling:', targetPath.yellow);

    if (target === 'lib_samples_readme' || target === 'samples_readme') {
      // Prepare config for the samples, if any
      expandOpts(opts, buildPack);
    }

    // Prepare the data for the template
    const data = _.merge(opts, targetConfig.data || {}, buildPack.config);
    data.lib_pkg_name = buildPack.config.generate.lib_readme.getLibPkgName(buildPack);
    // Other data prep
    if (target === 'lib_readme') {
      if (buildPack.config.generate.lib_readme.quickstart_filename) {
        data.quickstart = getQuickstart(path.join(opts.localPath, buildPack.config.generate.lib_readme.quickstart_filename), 'utf-8');
      }
      data.lib_install_cmd = buildPack.config.generate.lib_readme.lib_install_cmd.replace('{{name}}', data.lib_pkg_name);
    }

    // Load the target's template
    const tpl = path.join(__dirname, `../../../templates/${target}.tpl`);
    // Validate the data for the given target is sufficient
    if (targetConfig.validate) {
      targetConfig.validate(data);
    }

    // Generate the content
    const generated = handlebars.compile(fs.readFileSync(tpl, 'utf-8'))(data);

    if (opts.dryRun) {
      utils.logger.log(CLI_CMD, `Printing: ${targetPath.yellow}\n${generated}`);
      return;
    }

    // Write the content to the target's filename
    fs.writeFile(targetPath, generated, (err) => {
      if (err) {
        utils.logger.logger.error('generate', err.stack || err.message);
        process.exit(1);
      }

      utils.logger.log(CLI_CMD, `Generated: ${targetPath}`.green);
    });
  });
};
