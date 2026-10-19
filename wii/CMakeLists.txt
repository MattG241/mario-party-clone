# All-Star Party, Wii edition. Builds boot.dol for the Wii (devkitPPC toolchain, see build-wii.sh) or a
# native SDL2 executable for developing and testing on Linux (see build-linux.sh).
cmake_minimum_required(VERSION 3.13)
project(allstarparty LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

file(GLOB_RECURSE SOURCES CONFIGURE_DEPENDS src/*.cpp)
# -DMG_ONLY=<file stem> builds just one minigame (e.g. mg_donut_dash), so work on one doesn't need the others to compile
if(MG_ONLY)
  list(FILTER SOURCES EXCLUDE REGEX "/minigames/mg_.*\\.cpp$")
  list(APPEND SOURCES ${CMAKE_SOURCE_DIR}/src/minigames/${MG_ONLY}.cpp)
endif()
add_executable(allstarparty ${SOURCES})
target_compile_options(allstarparty PRIVATE -Wall -Wno-unused-function -fno-exceptions -fno-rtti)
# -DASP_AUTODEMO=ON: a test build that boots straight into an all-CPU match (for the emulator)
if(ASP_AUTODEMO)
  target_compile_definitions(allstarparty PRIVATE ASP_AUTODEMO)
endif()
# -DASP_AUTOROSTER=ON: a test build that scrolls quickly through the roster on the select screen
if(ASP_AUTOROSTER)
  target_compile_definitions(allstarparty PRIVATE ASP_AUTOROSTER)
endif()
# -DASP_AUTOTOUR=ON: a test build that plays every minigame once with four CPUs
if(ASP_AUTOTOUR)
  target_compile_definitions(allstarparty PRIVATE ASP_AUTOTOUR)
endif()

find_package(PkgConfig REQUIRED)
if("${CMAKE_SYSTEM_NAME}" STREQUAL "NintendoWii")
  # static link: ask pkg-config for every private dependency too
  execute_process(COMMAND ${PKG_CONFIG_EXECUTABLE} --static --libs SDL2_ttf SDL2_image SDL2_mixer sdl2
                  OUTPUT_VARIABLE SDL_LIBS OUTPUT_STRIP_TRAILING_WHITESPACE)
  execute_process(COMMAND ${PKG_CONFIG_EXECUTABLE} --cflags SDL2_ttf SDL2_image SDL2_mixer sdl2
                  OUTPUT_VARIABLE SDL_CFLAGS OUTPUT_STRIP_TRAILING_WHITESPACE)
  separate_arguments(SDL_LIBS)
  separate_arguments(SDL_CFLAGS)
  target_compile_options(allstarparty PRIVATE ${SDL_CFLAGS} -O2)
  target_link_libraries(allstarparty PRIVATE ${SDL_LIBS})
  ogc_create_dol(allstarparty)
else()
  pkg_check_modules(SDL REQUIRED sdl2 SDL2_image SDL2_mixer SDL2_ttf)
  target_include_directories(allstarparty PRIVATE ${SDL_INCLUDE_DIRS})
  target_link_libraries(allstarparty PRIVATE ${SDL_LIBRARIES})
endif()
