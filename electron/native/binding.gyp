{
  "targets": [
    {
      "target_name": "accessibility",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "conditions": [
        ['OS=="mac"', {
          "sources": [
            "accessibility.mm"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          },
          "link_settings": {
            "libraries": [
              "-framework ApplicationServices",
              "-framework CoreFoundation"
            ]
          },
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS"
          ]
        }],
        ['OS!="mac"', {
          "sources": [
            "accessibility-stub.cpp"
          ],
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS"
          ]
        }]
      ]
    }
  ]
}