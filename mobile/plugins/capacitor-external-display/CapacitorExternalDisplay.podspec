require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'CapacitorExternalDisplay'
  s.version      = package['version']
  s.summary      = package['description']
  s.license      = { :type => 'MIT' }
  s.homepage     = 'https://github.com/nicholasgalante/scicp'
  s.author       = 'scicp'
  s.source       = { :git => 'https://github.com/nicholasgalante/scicp.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.swift_version = '5.1'
  s.dependency 'Capacitor'
end
