const { withAppBuildGradle } = require('expo/config-plugins');

// Windows Ninja can exceed its path limit in long workspaces. Keep the override
// opt-in and local: no machine-specific path is committed into the native project.
module.exports = function withShortCmakePath(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== 'groovy') throw new Error('Expected Groovy app build file');
    if (!result.modResults.contents.includes('// shango-short-cmake-path')) {
      result.modResults.contents += `
// shango-short-cmake-path
def shangoCmakeDirectory = System.getenv("SHANGO_CMAKE_BUILD_DIR")
if (shangoCmakeDirectory) {
    android {
        externalNativeBuild {
            cmake {
                buildStagingDirectory = file(shangoCmakeDirectory)
            }
        }
    }
}
`;
    }
    return result;
  });
};
